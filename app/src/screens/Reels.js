import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, Pressable, Alert } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';
import { Text, TextInput, Button } from '../ui';
import { supabase } from '../supabase';
import { api } from '../api';
import { uuid } from '../offline';

const SEL = 'id,user_id,video_url,caption,profiles!reels_user_id_fkey(username),reel_likes(user_id)';
const applyLike = (it, me) => { // UI optimista: cambia el like en el estado local
  const liked = it.reel_likes.some((l) => l.user_id === me);
  return { ...it, reel_likes: liked ? it.reel_likes.filter((l) => l.user_id !== me) : [...it.reel_likes, { user_id: me }] };
};
const sendLike = (it, me) => (it.reel_likes.some((l) => l.user_id === me) // recibe el reel ANTES de aplicar el cambio
  ? supabase.from('reel_likes').delete().match({ reel_id: it.id, user_id: me })
  : supabase.from('reel_likes').upsert({ reel_id: it.id, user_id: me }, { onConflict: 'reel_id,user_id', ignoreDuplicates: true }));

// Solo el reel visible crea un reproductor: así no se gasta memoria con los demás.
function Player({ uri, playing }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; });
  useEffect(() => { if (playing) player.play(); else player.pause(); }, [playing, player]);
  return <VideoView player={player} style={{ flex: 1 }} contentFit="cover" nativeControls={false} />;
}

function Reel({ item, h, active, me, onLike }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => { setPaused(false); }, [active]);
  const liked = item.reel_likes.some((l) => l.user_id === me);
  return (
    <Pressable onPress={() => setPaused((p) => !p)} style={{ height: h, backgroundColor: '#000' }}>
      {active ? <Player uri={item.video_url} playing={!paused} /> : null}
      {active && paused && <Text style={{ position: 'absolute', alignSelf: 'center', top: h / 2 - 30, fontSize: 60, color: '#fff' }}>▶</Text>}
      <View style={{ position: 'absolute', right: 14, bottom: 90, alignItems: 'center', gap: 4 }}>
        <TouchableOpacity onPress={() => onLike(item)}><Text style={{ fontSize: 34 }}>{liked ? '❤️' : '🤍'}</Text></TouchableOpacity>
        <Text style={{ color: '#fff' }}>{item.reel_likes.length}</Text>
      </View>
      <View style={{ position: 'absolute', left: 14, right: 80, bottom: 24 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>@{item.profiles?.username}</Text>
        {!!item.caption && <Text style={{ color: '#fff' }}>{item.caption}</Text>}
      </View>
    </Pressable>
  );
}

export function Reels({ navigation, me }) {
  const focused = useIsFocused(); // al cambiar de pestaña el video se pausa
  const [items, setItems] = useState([]); const [h, setH] = useState(0); const [idx, setIdx] = useState(0); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const r = await supabase.from('reels').select(SEL).order('created_at', { ascending: false }).limit(30);
    if (r.error) console.warn('[reels]', r.error.message);
    setItems(r.data || []); setLoading(false);
  }, []);
  useEffect(() => { load(); return navigation.addListener('focus', load); }, [load]);
  useEffect(() => { navigation.setOptions({ headerRight: () => <Text style={{ fontSize: 22 }} onPress={() => navigation.navigate('CreateReel')}>➕</Text> }); }, []);
  const onViewable = useRef(({ viewableItems }) => { if (viewableItems[0]) setIdx(viewableItems[0].index); }).current;
  const viewCfg = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const like = async (it) => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? applyLike(x, me) : x)));
    const r = await sendLike(it, me);
    if (r.error) { console.warn('[reels like]', r.error.message); load(); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {h > 0 && (
        <FlatList data={items} keyExtractor={(x) => x.id} pagingEnabled snapToInterval={h} decelerationRate="fast" showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })} windowSize={3} initialNumToRender={1} maxToRenderPerBatch={2}
          onViewableItemsChanged={onViewable} viewabilityConfig={viewCfg} onRefresh={load} refreshing={false}
          renderItem={({ item, index }) => <Reel item={item} h={h} me={me} active={focused && index === idx} onLike={like} />} />
      )}
      {!loading && items.length === 0 && <Text style={{ position: 'absolute', alignSelf: 'center', top: '45%', color: '#fff', textAlign: 'center', padding: 30 }}>Aún no hay reels. Toca ➕ para subir el primero.</Text>}
    </View>
  );
}

// Un solo reel a pantalla completa. Si es tuyo: editar descripción o eliminar.
export function ReelDetail({ route, navigation, me }) {
  const id = route.params.id; const focused = useIsFocused();
  const [it, setIt] = useState(null); const [h, setH] = useState(0); const [editing, setEditing] = useState(false); const [cap, setCap] = useState('');
  useEffect(() => { supabase.from('reels').select(SEL).eq('id', id).single().then((r) => setIt(r.data)); }, [id]);
  const like = async (x) => { setIt(applyLike(x, me)); const r = await sendLike(x, me); if (r.error) { console.warn('[reels like]', r.error.message); setIt(x); } };
  const saveCap = async () => {
    try { await api('/reels/' + id, 'PATCH', { caption: cap }); setIt({ ...it, caption: cap.trim() }); setEditing(false); }
    catch (e) { Alert.alert('No se pudo guardar', e.message); }
  };
  const del = () => Alert.alert('Eliminar reel', 'Se borrará el video y sus likes. No se puede deshacer.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => { try { await api('/reels/' + id, 'DELETE'); navigation.goBack(); } catch (e) { Alert.alert('No se pudo eliminar', e.message); } } },
  ]);
  const mine = it?.user_id === me;
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {!it && <Text style={{ color: '#fff', padding: 20 }}>Cargando o sin acceso…</Text>}
      {it && h > 0 && <Reel item={it} h={h} me={me} active={focused} onLike={like} />}
      {mine && !editing && (
        <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 }}>
          <Button title="Editar" onPress={() => { setCap(it.caption || ''); setEditing(true); }} />
          <Button title="Eliminar" color="#c00" onPress={del} />
        </View>
      )}
      {mine && editing && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#000d', padding: 12, gap: 8 }}>
          <TextInput value={cap} onChangeText={setCap} multiline maxLength={2200} placeholder="Descripción" placeholderTextColor="#999" style={{ color: '#fff', borderWidth: 1, borderColor: '#555', padding: 8, minHeight: 60 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Guardar" onPress={saveCap} /><Button title="Cancelar" color="#888" onPress={() => setEditing(false)} /></View>
        </View>
      )}
    </View>
  );
}

export function CreateReel({ navigation, me }) {
  const [uri, setUri] = useState(null); const [cap, setCap] = useState(''); const [busy, setBusy] = useState(false);
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 });
    if (!r.canceled) setUri(r.assets[0].uri);
  };
  const publish = async () => {
    setBusy(true);
    try {
      const info = await FS.getInfoAsync(uri);
      if (info.size > 50 * 1024 * 1024) throw new Error('El video pesa más de 50 MB (límite del plan gratis de Supabase). Elige uno más corto.');
      const { data } = await supabase.auth.getSession();
      const ext = (uri.split('.').pop() || 'mp4').toLowerCase().split('?')[0];
      const path = `${me}/reel-${uuid()}.${ext}`;
      const res = await FS.uploadAsync(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/media/${path}`, uri, { // sube el archivo por streaming, sin cargarlo en memoria
        httpMethod: 'POST', uploadType: FS.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': ext === 'mov' ? 'video/quicktime' : 'video/mp4' },
      });
      if (res.status !== 200) throw new Error('Storage respondió ' + res.status + ': ' + res.body);
      const video_url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('reels').insert({ user_id: me, video_url, caption: cap.trim() });
      if (error) throw error;
      navigation.goBack();
    } catch (e) { Alert.alert('No se pudo publicar', e.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Button title="Elegir video (máx. 60 s)" onPress={pick} />
      {uri && <Text style={{ color: '#2a7' }}>✓ Video seleccionado</Text>}
      <TextInput placeholder="Descripción (ej. Capítulo 1: La pera traicionera)" value={cap} onChangeText={setCap} style={{ borderWidth: 1, borderColor: '#ddd', padding: 8 }} />
      <Button title={busy ? 'Subiendo…' : 'Publicar reel'} disabled={!uri || busy} onPress={publish} />
    </View>
  );
}