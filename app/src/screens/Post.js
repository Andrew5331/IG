import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, Switch, Image, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabase';
import { api } from '../api';
import { enqueue, uuid } from '../offline';
import PostCard from '../PostCard';
import CachedImage from '../CachedImage';
import { Text, TextInput, Button } from '../ui';

const ago = (iso) => { const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd'; };
const CSEL = 'id,user_id,body,created_at,profiles!comments_user_id_fkey(username,avatar_url),comment_likes(user_id)';
const EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

function CommentRow({ c, me, onLike, onProfile, onReply }) {
  const liked = c.comment_likes.some((l) => l.user_id === me);
  const av = { width: 36, height: 36, borderRadius: 18 };
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 12 }}>
      <TouchableOpacity onPress={() => onProfile(c.user_id)}>{c.profiles?.avatar_url ? <CachedImage uri={c.profiles.avatar_url} style={av} /> : <View style={[av, { backgroundColor: '#262626' }]} />}</TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text><Text style={{ fontWeight: '700' }} onPress={() => onProfile(c.user_id)}>{c.profiles?.username} </Text><Text style={{ color: '#a8a8a8' }}>{ago(c.created_at)}</Text></Text>
        <Text style={{ marginTop: 2 }}>{c.body}</Text>
        <Text style={{ color: '#a8a8a8', marginTop: 4, fontWeight: '600' }} onPress={() => onReply(c.profiles?.username)}>Responder</Text>
      </View>
      <TouchableOpacity onPress={() => onLike(c)} style={{ alignItems: 'center' }}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? '#ff3040' : '#fff'} />
        {c.comment_likes.length > 0 && <Text style={{ color: '#a8a8a8', fontSize: 12 }}>{c.comment_likes.length}</Text>}
      </TouchableOpacity>
    </View>
  );
}

export function PostDetail({ route, navigation, me }) {
  const id = route.params.id;
  const [post, setPost] = useState(null); const [cs, setCs] = useState([]); const [t, setT] = useState(''); const [myAv, setMyAv] = useState(null);
  const [editing, setEditing] = useState(false); const [cap, setCap] = useState('');
  const loadC = useCallback(() => supabase.from('comments').select(CSEL).eq('post_id', id).order('created_at').then((r) => { if (r.error) console.warn('[comentarios]', r.error.message); if (r.data) setCs(r.data); }), [id]);
  useEffect(() => {
    supabase.from('posts').select('id,user_id,image_url,caption,profiles!posts_user_id_fkey(username,avatar_url),likes(user_id)').eq('id', id).single().then((r) => setPost(r.data));
    supabase.from('profiles').select('avatar_url').eq('id', me).single().then((r) => setMyAv(r.data?.avatar_url));
    loadC();
    const ch = supabase.channel('c-' + id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${id}` }, loadC).subscribe();
    return () => supabase.removeChannel(ch);
  }, [id]);
  const goProfile = (u) => navigation.push('UserProfile', { id: u });
  const send = () => { // UI optimista: aparece ya y la red va por la cola
    if (!t.trim()) return;
    const c = { id: uuid(), post_id: id, user_id: me, body: t.trim() };
    setCs((x) => [...x, { ...c, created_at: new Date().toISOString(), pending: true, profiles: { username: 'tú', avatar_url: myAv }, comment_likes: [] }]);
    setT(''); enqueue('comment', c);
  };
  const likeC = async (c) => {
    if (c.pending) return;
    const liked = c.comment_likes.some((l) => l.user_id === me);
    setCs((xs) => xs.map((x) => (x.id === c.id ? { ...x, comment_likes: liked ? x.comment_likes.filter((l) => l.user_id !== me) : [...x.comment_likes, { user_id: me }] } : x)));
    const r = liked
      ? await supabase.from('comment_likes').delete().match({ comment_id: c.id, user_id: me })
      : await supabase.from('comment_likes').upsert({ comment_id: c.id, user_id: me }, { onConflict: 'comment_id,user_id', ignoreDuplicates: true });
    if (r.error) { console.warn('[like comentario]', r.error.message); loadC(); }
  };
  const saveCap = async () => {
    try { await api('/posts/' + id, 'PATCH', { caption: cap }); setPost({ ...post, caption: cap.trim() }); setEditing(false); }
    catch (e) { Alert.alert('No se pudo guardar', e.message); }
  };
  const del = () => Alert.alert('Eliminar publicación', 'Se borrarán también sus likes y comentarios. No se puede deshacer.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => { try { await api('/posts/' + id, 'DELETE'); navigation.goBack(); } catch (e) { Alert.alert('No se pudo eliminar', e.message); } } },
  ]);
  if (!post) return <Text style={{ padding: 20 }}>Cargando o sin acceso (cuenta privada)…</Text>;
  const mine = post.user_id === me;
  const header = (
    <View>
      <PostCard post={post} me={me} onProfile={goProfile} />
      {mine && (editing ? (
        <View style={{ padding: 10, gap: 6 }}>
          <TextInput value={cap} onChangeText={setCap} multiline maxLength={2200} placeholder="Descripción" style={{ borderWidth: 1, borderColor: '#363636', padding: 8, minHeight: 60 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Guardar" onPress={saveCap} /><Button kind="secondary" title="Cancelar" onPress={() => setEditing(false)} /></View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 8 }}>
          <Button kind="secondary" title="Editar descripción" onPress={() => { setCap(post.caption || ''); setEditing(true); }} />
          <Button kind="danger" title="Eliminar" onPress={del} />
        </View>
      ))}
      <Text style={{ textAlign: 'center', fontWeight: '600', paddingVertical: 12, borderTopWidth: 1, borderColor: '#262626' }}>Comentarios</Text>
    </View>
  );
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList data={cs} keyExtractor={(x) => x.id} ListHeaderComponent={header} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#a8a8a8', padding: 24 }}>Aún no hay comentarios. ¡Sé el primero!</Text>}
        renderItem={({ item }) => <CommentRow c={item} me={me} onLike={likeC} onProfile={goProfile} onReply={(name) => setT((x) => `@${name} ${x}`)} />} />
      <View style={{ borderTopWidth: 1, borderColor: '#262626', backgroundColor: '#000' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10 }}>
          {EMOJIS.map((e) => <Text key={e} style={{ fontSize: 26 }} onPress={() => setT((x) => x + e)}>{e}</Text>)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12 }}>
          {myAv ? <CachedImage uri={myAv} style={{ width: 38, height: 38, borderRadius: 19 }} /> : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#262626' }} />}
          <TextInput value={t} onChangeText={setT} placeholder={`Añade un comentario para ${post.profiles?.username}…`} style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: '#363636', backgroundColor: 'transparent' }} />
          {!!t.trim() && <Text style={{ color: '#0095f6', fontWeight: '700' }} onPress={send}>Publicar</Text>}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function Create({ navigation, me }) {
  const [img, setImg] = useState(null); const [cap, setCap] = useState(''); const [story, setStory] = useState(false);
  const pick = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }); if (!r.canceled) setImg(r.assets[0].uri); };
  const publish = () => { // se encola con la URI local: funciona sin conexión
    enqueue(story ? 'story' : 'post', { id: uuid(), user_id: me, uri: img, caption: cap });
    Alert.alert('Publicando…', 'Si no hay conexión, se enviará cuando vuelva. Desliza el feed hacia abajo para refrescar.'); navigation.goBack();
  };
  return (<View style={{ padding: 16, gap: 10 }}><Button title="Elegir imagen" onPress={pick} />{img && <Image source={{ uri: img }} style={{ height: 240 }} />}
    <TextInput placeholder="Descripción" value={cap} onChangeText={setCap} style={{ borderWidth: 1, borderColor: '#ddd', padding: 8 }} />
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Switch value={story} onValueChange={setStory} /><Text> Subir como historia (24h)</Text></View>
    <Button title="Publicar" disabled={!img} onPress={publish} /></View>);
}