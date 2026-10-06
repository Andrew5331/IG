import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, ScrollView, Switch, TouchableOpacity, Image, Alert, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import { api } from '../api';
import CachedImage from '../CachedImage';
import { Text, TextInput, Button } from '../ui';

const Avatar = ({ uri, size = 72 }) => uri
  ? <CachedImage uri={uri} style={{ width: size, height: size, borderRadius: size / 2 }} />
  : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#262626' }} />;

const TabsBar = ({ tab, setTab }) => (
  <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: '#262626' }}>
    {[['posts', 'grid', 'grid-outline'], ['reels', 'play-circle', 'play-circle-outline']].map(([k, on, off]) => (
      <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderColor: tab === k ? '#fff' : 'transparent' }}>
        <Ionicons name={tab === k ? on : off} size={26} color={tab === k ? '#fff' : '#777'} />
      </TouchableOpacity>))}
  </View>
);
const ReelTile = ({ item, onPress }) => (
  <TouchableOpacity onPress={onPress} style={{ flex: 1 / 3, aspectRatio: 3 / 4, padding: 0.5 }}>
    <View style={{ flex: 1, backgroundColor: '#1c1c1c', justifyContent: 'space-between', padding: 6 }}>
      <Ionicons name="play" size={18} color="#fff" />
      <View><Text numberOfLines={2} style={{ fontSize: 11 }}>{item.caption}</Text><Text style={{ fontSize: 11 }}>❤️ {item.reel_likes?.length || 0}</Text></View>
    </View>
  </TouchableOpacity>
);
const counts = async (id) => {
  const a = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following', id).eq('status', 'accepted');
  const b = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', id).eq('status', 'accepted');
  return [a.count || 0, b.count || 0];
};
// Cabecera estilo Instagram: foto + 3 contadores, nombre, bio, botones y pestañas
function ProfileHeader({ p, stats, tab, setTab, children }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
        <Avatar uri={p?.avatar_url} size={86} />
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 10 }}>
          {stats.map(([n, label, onPress]) => (
            <TouchableOpacity key={label} onPress={onPress} disabled={!onPress} style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700' }}>{n}</Text><Text style={{ color: '#a8a8a8', fontSize: 13 }}>{label}</Text>
            </TouchableOpacity>))}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <Text style={{ fontWeight: '700' }}>{p?.username}{p?.is_private ? '  🔒' : ''}</Text>
        {!!p?.bio && <Text style={{ marginTop: 2 }}>{p.bio}</Text>}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>{children}</View>
      <TabsBar tab={tab} setTab={setTab} />
    </View>
  );
}

export function Explore({ navigation, me }) {
  const [q, setQ] = useState(''); const [users, setUsers] = useState([]); const [posts, setPosts] = useState([]); const [rel, setRel] = useState({});
  const loadGrid = useCallback(async () => { // fotos de otras cuentas (RLS ya oculta las privadas que no sigues) + mi estado de seguimiento
    const r = await supabase.from('posts').select('id,image_url').neq('user_id', me).order('created_at', { ascending: false }).limit(60);
    if (r.error) console.warn('[explorar]', r.error.message);
    setPosts(r.data || []);
    const f = await supabase.from('follows').select('following,status').eq('follower', me);
    setRel(Object.fromEntries((f.data || []).map((x) => [x.following, x.status])));
  }, [me]);
  useEffect(() => { loadGrid(); return navigation.addListener('focus', loadGrid); }, [loadGrid]);
  useEffect(() => { // buscador por nombre con espera de 300 ms
    const t = q.replace(/[%_,]/g, '').trim();
    if (!t) { setUsers([]); return; }
    const id = setTimeout(async () => {
      const r = await supabase.from('profiles').select('id,username,is_private').ilike('username', `%${t}%`).neq('id', me).limit(30);
      setUsers(r.data || []);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  const toggle = async (u) => {
    const was = rel[u.id];
    try {
      const r = await api('/follow/' + u.id, was ? 'DELETE' : 'POST');
      setRel((x) => { const n = { ...x }; if (was) delete n[u.id]; else n[u.id] = r.status; return n; });
    } catch (e) { alert(e.message); }
  };
  const label = (id) => (rel[id] === 'accepted' ? 'Siguiendo' : rel[id] === 'pending' ? 'Solicitado' : 'Seguir');
  const searching = q.trim().length > 0;
  return (
    <View style={{ flex: 1 }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Buscar usuarios" autoCapitalize="none" style={{ margin: 10, padding: 10, borderRadius: 8, backgroundColor: '#262626' }} />
      {searching ? (
        <FlatList key="usuarios" data={users} keyExtractor={(u) => u.id} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ padding: 20, textAlign: 'center', color: '#666' }}>Sin resultados</Text>}
          renderItem={({ item }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
              <Text style={{ flex: 1 }} onPress={() => navigation.navigate('UserProfile', { id: item.id })}>{item.username}{item.is_private ? ' 🔒' : ''}</Text>
              <Button title={label(item.id)} onPress={() => toggle(item)} />
              <Button title="Mensaje" onPress={() => navigation.navigate('Chat', { peer: item.id, name: item.username })} />
            </View>)} />
      ) : (
        <FlatList key="cuadricula" data={posts} numColumns={3} keyExtractor={(x) => x.id} onRefresh={loadGrid} refreshing={false}
          ListEmptyComponent={<Text style={{ padding: 20, textAlign: 'center', color: '#666' }}>Aún no hay publicaciones de otras cuentas</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ flex: 1 / 3, aspectRatio: 1, padding: 1 }} onPress={() => navigation.navigate('PostDetail', { id: item.id })}>
              <CachedImage uri={item.image_url} style={{ flex: 1 }} />
            </TouchableOpacity>)} />
      )}
    </View>
  );
}

export function Activity({ me }) {
  const [reqs, setReqs] = useState([]);
  const load = useCallback(() => supabase.from('follows').select('follower,profiles!follows_follower_fkey(username)').eq('following', me).eq('status', 'pending').then((r) => setReqs(r.data || [])), []);
  useEffect(() => { load(); }, []);
  const answer = async (f, ok) => { try { await api(`/follow/${f}/respond`, 'POST', { accept: ok }); } catch (e) { alert(e.message); } load(); };
  return (<FlatList data={reqs} keyExtractor={(r) => r.follower} ListEmptyComponent={<Text style={{ padding: 20 }}>Sin solicitudes pendientes</Text>} renderItem={({ item }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}><Text style={{ flex: 1 }}>{item.profiles?.username} quiere seguirte</Text>
      <Button title="Aceptar" onPress={() => answer(item.follower, true)} /><Button title="Rechazar" color="#c00" onPress={() => answer(item.follower, false)} /></View>)} />);
}

export function Profile({ me, navigation }) {
  const [p, setP] = useState(null); const [posts, setPosts] = useState([]); const [reels, setReels] = useState([]); const [tab, setTab] = useState('posts'); const [cnt, setCnt] = useState([0, 0]);
  const load = useCallback(async () => { // se recarga cada vez que entras a la pestaña
    setP((await supabase.from('profiles').select('*').eq('id', me).single()).data);
    const r = await supabase.from('posts').select('id,image_url').eq('user_id', me).order('created_at', { ascending: false });
    if (r.error) console.warn('[perfil]', r.error.message);
    setPosts(r.data || []);
    const v = await supabase.from('reels').select('id,caption,reel_likes(user_id)').eq('user_id', me).order('created_at', { ascending: false });
    if (v.error) console.warn('[perfil reels]', v.error.message);
    setReels(v.data || []);
    setCnt(await counts(me));
  }, [me]);
  useEffect(() => { load(); return navigation.addListener('focus', load); }, [load]);
  const isPosts = tab === 'posts';
  return (<FlatList data={isPosts ? posts : reels} numColumns={3} keyExtractor={(x) => x.id} onRefresh={load} refreshing={false}
    ListEmptyComponent={<Text style={{ padding: 30, textAlign: 'center', color: '#777' }}>{isPosts ? 'Aún no has publicado nada' : 'Aún no has subido reels'}</Text>}
    ListHeaderComponent={<ProfileHeader p={p} tab={tab} setTab={setTab}
      stats={[[posts.length, 'publicaciones'], [cnt[0], 'seguidores', () => navigation.navigate('FollowList', { id: me, mode: 'followers' })], [cnt[1], 'seguidos', () => navigation.navigate('FollowList', { id: me, mode: 'following' })]]}>
      <Button kind="secondary" title="Editar perfil" style={{ flex: 1 }} onPress={() => navigation.navigate('EditProfile')} />
      <Button kind="secondary" title="Compartir perfil" style={{ flex: 1 }} onPress={() => Share.share({ message: `Sígueme en SocIAl: @${p?.username}` })} />
    </ProfileHeader>}
    renderItem={({ item }) => isPosts
      ? <TouchableOpacity style={{ flex: 1 / 3, aspectRatio: 1, padding: 0.5 }} onPress={() => navigation.navigate('PostDetail', { id: item.id })}><CachedImage uri={item.image_url} style={{ flex: 1 }} /></TouchableOpacity>
      : <ReelTile item={item} onPress={() => navigation.navigate('ReelDetail', { id: item.id })} />} />);
}

const Field = ({ label, children }) => (
  <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#262626' }}>
    <Text style={{ color: '#a8a8a8', fontSize: 12 }}>{label}</Text>{children}
  </View>
);
const flat = { backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 4, fontSize: 16 };

export function EditProfile({ me, navigation }) {
  const [username, setUsername] = useState(''); const [bio, setBio] = useState(''); const [priv, setPriv] = useState(false);
  const [avatar, setAvatar] = useState(null); const [newUri, setNewUri] = useState(null); const [saving, setSaving] = useState(false);
  useEffect(() => { supabase.from('profiles').select('username,bio,avatar_url,is_private').eq('id', me).single().then(({ data }) => { if (data) { setUsername(data.username || ''); setBio(data.bio || ''); setAvatar(data.avatar_url); setPriv(!!data.is_private); } }); }, []);
  const pick = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 }); if (!r.canceled) setNewUri(r.assets[0].uri); };
  const save = async () => {
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,20}$/.test(u)) return Alert.alert('Nombre inválido', 'Usa de 3 a 20 caracteres: letras minúsculas, números, punto o guion bajo.');
    setSaving(true);
    try {
      let avatar_url = avatar;
      if (newUri) {
        const b64 = await FS.readAsStringAsync(newUri, { encoding: 'base64' });
        const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        if (buf.length < 100) throw new Error('La imagen está vacía');
        const path = `${me}/avatar-${Date.now()}.jpg`; // nombre nuevo => la caché no muestra la foto vieja
        const up = await supabase.storage.from('media').upload(path, buf, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        avatar_url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from('profiles').update({ username: u, bio: bio.trim().slice(0, 150), avatar_url, is_private: priv }).eq('id', me);
      if (error) throw new Error(error.code === '23505' ? 'Ese nombre de usuario ya está en uso' : error.message);
      navigation.goBack();
    } catch (e) { Alert.alert('No se pudo guardar', e.message); } finally { setSaving(false); }
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={pick} style={{ alignItems: 'center', gap: 10, paddingVertical: 20 }}>
        {newUri ? <Image source={{ uri: newUri }} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Avatar uri={avatar} size={96} />}
        <Text style={{ color: '#0095f6', fontWeight: '600' }}>Editar foto</Text>
      </TouchableOpacity>
      <Field label="Nombre de usuario"><TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={20} style={flat} /></Field>
      <Field label={`Biografía  ·  ${bio.length}/150`}><TextInput value={bio} onChangeText={setBio} multiline maxLength={150} style={[flat, { minHeight: 60 }]} /></Field>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#262626' }}>
        <View style={{ flex: 1, paddingRight: 12 }}><Text style={{ fontSize: 16 }}>Cuenta privada</Text><Text style={{ color: '#a8a8a8', fontSize: 12 }}>Solo tus seguidores aprobados ven tus publicaciones.</Text></View>
        <Switch value={priv} onValueChange={setPriv} />
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        <Button title={saving ? 'Guardando…' : 'Guardar'} disabled={saving} onPress={save} />
        <Button kind="danger" title="Cerrar sesión" onPress={() => supabase.auth.signOut()} />
      </View>
    </ScrollView>
  );
}

export function UserProfile({ route, navigation, me }) {
  const id = route.params.id; const [p, setP] = useState(null); const [posts, setPosts] = useState([]); const [reels, setReels] = useState([]); const [tab, setTab] = useState('posts');
  const [rel, setRel] = useState(null); const [cnt, setCnt] = useState([0, 0]);
  const load = useCallback(async () => {
    setP((await supabase.from('profiles').select('*').eq('id', id).single()).data);
    setRel((await supabase.from('follows').select('status').match({ follower: me, following: id }).maybeSingle()).data?.status || null);
    setPosts((await supabase.from('posts').select('id,image_url').eq('user_id', id).order('created_at', { ascending: false })).data || []); // RLS: vacío si es privada y no te sigue
    setReels((await supabase.from('reels').select('id,caption,reel_likes(user_id)').eq('user_id', id).order('created_at', { ascending: false })).data || []);
    setCnt(await counts(id));
  }, [id]);
  useEffect(() => { load(); return navigation.addListener('focus', load); }, [id]);
  const toggle = async () => {
    try { await api('/follow/' + id, rel ? 'DELETE' : 'POST'); } catch (e) { alert(e.message); }
    load();
  };
  const locked = p?.is_private && rel !== 'accepted' && id !== me;
  const isPosts = tab === 'posts';
  const go = (mode) => (locked ? undefined : () => navigation.push('FollowList', { id, mode }));
  return (<FlatList data={isPosts ? posts : reels} numColumns={3} keyExtractor={(x) => x.id}
    ListEmptyComponent={<Text style={{ padding: 30, textAlign: 'center', color: '#777' }}>{locked ? 'Esta cuenta es privada. Sigue para ver su contenido.' : isPosts ? 'Sin publicaciones' : 'Sin reels'}</Text>}
    ListHeaderComponent={<ProfileHeader p={p} tab={tab} setTab={setTab} stats={[[posts.length, 'publicaciones'], [cnt[0], 'seguidores', go('followers')], [cnt[1], 'seguidos', go('following')]]}>
      {id !== me && <>
        <Button kind={rel ? 'secondary' : 'primary'} title={rel === 'accepted' ? 'Siguiendo' : rel === 'pending' ? 'Solicitado' : 'Seguir'} style={{ flex: 1 }} onPress={toggle} />
        <Button kind="secondary" title="Mensaje" style={{ flex: 1 }} onPress={() => navigation.navigate('Chat', { peer: id, name: p?.username })} />
      </>}
    </ProfileHeader>}
    renderItem={({ item }) => isPosts
      ? <TouchableOpacity style={{ flex: 1 / 3, aspectRatio: 1, padding: 0.5 }} onPress={() => navigation.navigate('PostDetail', { id: item.id })}><CachedImage uri={item.image_url} style={{ flex: 1 }} /></TouchableOpacity>
      : <ReelTile item={item} onPress={() => navigation.navigate('ReelDetail', { id: item.id })} />} />);
}

export function FollowList({ route, navigation, me }) {
  const { id, mode } = route.params || {};
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: mode === 'followers' ? 'Seguidores' : 'Seguidos' });
    async function fetchFollows() {
      setLoading(true);
      try {
        let query;
        if (mode === 'followers') {
          query = supabase
            .from('follows')
            .select('follower, profiles!follows_follower_fkey(id, username, avatar_url)')
            .eq('following', id)
            .eq('status', 'accepted');
        } else {
          query = supabase
            .from('follows')
            .select('following, profiles!follows_following_fkey(id, username, avatar_url)')
            .eq('follower', id)
            .eq('status', 'accepted');
        }
        const { data, error } = await query;
        if (error) console.warn('[FollowList]', error.message);
        const users = (data || []).map((x) => x.profiles).filter(Boolean);
        setList(users);
      } catch (err) {
        console.warn('[FollowList err]', err);
      } finally {
        setLoading(false);
      }
    }
    fetchFollows();
  }, [id, mode]);

  return (
    <FlatList
      data={list}
      keyExtractor={(item) => item.id}
      refreshing={loading}
      onRefresh={() => {}}
      ListEmptyComponent={
        !loading && (
          <Text style={{ padding: 20, textAlign: 'center', color: '#666' }}>
            {mode === 'followers' ? 'No tiene seguidores aún' : 'No sigue a nadie aún'}
          </Text>
        )
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 }}
          onPress={() => navigation.navigate(item.id === me ? 'Perfil' : 'UserProfile', { id: item.id })}
        >
          <Avatar uri={item.avatar_url} size={44} />
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '600' }}>{item.username}</Text>
        </TouchableOpacity>
      )}
    />
  );
}