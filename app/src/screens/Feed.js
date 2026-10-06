import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import {
  FlatList,
  View,
  TouchableOpacity,
  Modal,
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { kvGet, kvSet, isSeen, markSeen, onSync } from '../offline';
import PostCard from '../PostCard';
import CachedImage from '../CachedImage';
import { Text } from '../ui';
import { getImage } from '../imageCache';

const { width: W, height: H } = Dimensions.get('window');

// ── tiempo transcurrido estilo Instagram ──────────────────────────────────────
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// ── StoryViewer ───────────────────────────────────────────────────────────────
// groups : Story[][]  → cada elemento = historias de 1 usuario (más antigua → más nueva)
// initialGroup : índice del grupo con el que se abre el visor
function StoryViewer({ groups, initialGroup = 0, onClose }) {
  const [gIdx, setGIdx] = useState(initialGroup);
  const [sIdx, setSIdx] = useState(0);

  // refs para que los callbacks siempre lean el valor actual
  const gIdxRef = useRef(gIdx);
  const sIdxRef = useRef(sIdx);
  useEffect(() => { gIdxRef.current = gIdx; }, [gIdx]);
  useEffect(() => { sIdxRef.current = sIdx; }, [sIdx]);

  // historia y grupo actuales
  const group  = groups[gIdx] ?? [];
  const story  = group[sIdx];

  // ── barra de progreso ────────────────────────────────────────────────────
  const progress    = useRef(new Animated.Value(0)).current;
  const progressVal = useRef(0);   // valor 0-1 en tiempo real (para reanudar)
  const animRef     = useRef(null);
  const pausedRef   = useRef(false);

  useEffect(() => {
    const id = progress.addListener(({ value }) => { progressVal.current = value; });
    return () => progress.removeListener(id);
  }, []);

  // ── animación de cierre con swipe ────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;

  // ── visibilidad de UI (header + barras) ──────────────────────────────────
  const [uiVisible, setUiVisible] = useState(true);

  // ── avanzar / retroceder ─────────────────────────────────────────────────
  const goNext = useCallback(() => {
    const g = gIdxRef.current;
    const s = sIdxRef.current;
    const grp = groups[g] ?? [];
    if (s + 1 < grp.length) {
      setSIdx(s + 1);
    } else if (g + 1 < groups.length) {
      setGIdx(g + 1); setSIdx(0);
    } else {
      onClose();
    }
  }, [groups, onClose]);

  const goPrev = useCallback(() => {
    const g = gIdxRef.current;
    const s = sIdxRef.current;
    if (s > 0) {
      setSIdx(s - 1);
    } else if (g > 0) {
      const prev = groups[g - 1] ?? [];
      setGIdx(g - 1); setSIdx(Math.max(0, prev.length - 1));
    } else {
      // primera historia de todas → reinicia la barra
      progress.setValue(0); progressVal.current = 0;
      pausedRef.current = false;
      startAnimFn();
    }
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── arrancar / pausar / reanudar animación ───────────────────────────────
  // Usamos una función declarada con function para poder referenciarla en goPrev
  function startAnimFn() {
    if (pausedRef.current) return;
    animRef.current?.stop();
    const remaining = 1 - progressVal.current;
    animRef.current = Animated.timing(progress, {
      toValue: 1,
      duration: 5000 * remaining,
      useNativeDriver: false,
    });
    animRef.current.start(({ finished }) => {
      if (finished && !pausedRef.current) goNext();
    });
  }
  const startAnim  = useCallback(startAnimFn, [progress, goNext]); // eslint-disable-line react-hooks/exhaustive-deps
  const pauseAnim  = useCallback(() => { pausedRef.current = true;  animRef.current?.stop(); }, []);
  const resumeAnim = useCallback(() => { pausedRef.current = false; startAnimFn(); }, [startAnim]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── efecto principal: cambio de historia ─────────────────────────────────
  useEffect(() => {
    if (!story) return;
    progress.setValue(0); progressVal.current = 0; pausedRef.current = false;
    markSeen(story.id);
    startAnimFn();
    return () => animRef.current?.stop();
  }, [gIdx, sIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── precarga ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const urls = [];
    if (group[sIdx + 1])       urls.push(group[sIdx + 1].image_url);
    if (groups[gIdx + 1]?.[0]) urls.push(groups[gIdx + 1][0].image_url);
    const ctls = urls.map((url) => {
      const c = new AbortController();
      getImage(url, c.signal).catch(() => {});
      return c;
    });
    return () => ctls.forEach((c) => c.abort());
  }, [gIdx, sIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PanResponder (swipe-down + tap izq/der + long-press) ─────────────────
  const pressStart   = useRef(0);
  const isLong       = useRef(false);
  const isDragging   = useRef(false);
  const longTimer    = useRef(null);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gs) =>
      Math.abs(gs.dy) > 10 && Math.abs(gs.dy) > Math.abs(gs.dx),

    onPanResponderGrant: (evt) => {
      pressStart.current = Date.now();
      isLong.current     = false;
      isDragging.current = false;
      translateY.setValue(0);
      longTimer.current = setTimeout(() => {
        isLong.current = true;
        pauseAnim();
        setUiVisible(false);
      }, 250);
    },

    onPanResponderMove: (_, gs) => {
      if (gs.dy > 8) {
        clearTimeout(longTimer.current);
        isDragging.current = true;
        if (isLong.current) {
          isLong.current = false;
          resumeAnim();
          setUiVisible(true);
        }
        if (gs.dy > 0) translateY.setValue(gs.dy);
      }
    },

    onPanResponderRelease: (evt, gs) => {
      clearTimeout(longTimer.current);

      if (isLong.current) {
        // soltar después de long-press → reanudar sin cambiar
        isLong.current = false;
        resumeAnim();
        setUiVisible(true);
        return;
      }

      if (isDragging.current) {
        if (gs.dy > 80 || gs.vy > 0.8) {
          Animated.timing(translateY, { toValue: H, duration: 220, useNativeDriver: true })
            .start(() => onClose());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
        return;
      }

      // toque corto
      if (Date.now() - pressStart.current < 250) {
        if (gs.x0 < W / 2) goPrev(); else goNext();
      }
    },
  })).current;

  if (!story) return null;
  const profile = story.profiles ?? {};

  // barras de progreso del grupo actual
  const bars = group.map((_, k) => {
    const barW = k < sIdx ? '100%'
      : k === sIdx ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
      : '0%';
    return (
      <View key={k} style={sv.barBg}>
        <Animated.View style={[sv.barFill, { width: barW }]} />
      </View>
    );
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[sv.container, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
        <CachedImage uri={story.image_url} style={sv.image} />

        {uiVisible && (
          <View style={sv.header}>
            <View style={sv.barsRow}>{bars}</View>
            <View style={sv.meta}>
              <CachedImage uri={profile.avatar_url} style={sv.avatar} />
              <Text style={sv.username} numberOfLines={1}>{profile.username ?? '…'}</Text>
              <Text style={sv.time}>{timeAgo(story.created_at)}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const sv = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  image: { width: W, height: H, position: 'absolute' },
  header: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 36 : 52,
    left: 0, right: 0, paddingHorizontal: 8,
  },
  barsRow: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  barBg: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff', borderRadius: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#fff' },
  username: { fontWeight: '700', color: '#fff', fontSize: 14, flex: 1 },
  time: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginRight: 4 },
});

// ── ReelCard ──────────────────────────────────────────────────────────────────
function ReelCard({ item, onOpen, onProfile }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.user} onPress={() => onProfile(item.user_id)}>{item.profiles?.username} <Text style={{ fontWeight: '400', color: '#888' }}>· Reel</Text></Text>
      <TouchableOpacity activeOpacity={0.85} onPress={() => onOpen(item.id)} style={{ width: W, height: W, backgroundColor: '#1c1c1c', justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 64, color: '#fff' }}>▶</Text>
      </TouchableOpacity>
      <Text style={[s.txt, { paddingTop: 8 }]}>❤️ {item.reel_likes?.length || 0}</Text>
      <Text style={s.txt}><Text style={{ fontWeight: '700' }}>{item.profiles?.username} </Text>{item.caption}</Text>
    </View>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────
export default function Feed({ navigation, me }) {
  const [items, setItems]   = useState(kvGet('feed2') || []); // offline-first
  const [groups, setGroups] = useState([]);
  // open = { gIdx: number } | null
  const [open, setOpen]     = useState(null);
  const [, force]           = useState(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 864e5).toISOString();
    const [pr, rr, st] = await Promise.all([
      supabase.from('posts').select('id,user_id,image_url,caption,created_at,profiles!posts_user_id_fkey(username,avatar_url),likes(user_id)').order('created_at', { ascending: false }).limit(30),
      supabase.from('reels').select('id,user_id,caption,created_at,profiles!reels_user_id_fkey(username),reel_likes(user_id)').order('created_at', { ascending: false }).limit(15),
      supabase.from('stories').select('id,user_id,image_url,created_at,profiles(username,avatar_url)').gte('created_at', since).order('created_at'),
    ]);
    if (pr.error) console.warn('[feed]', pr.error.message);
    if (rr.error) console.warn('[feed reels]', rr.error.message);
    if (st.error) console.warn('[stories]', st.error.message);
    if (pr.data || rr.data) {
      const merged = [...(pr.data || []).map((x) => ({ ...x, kind: 'post' })), ...(rr.data || []).map((x) => ({ ...x, kind: 'reel' }))]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      setItems(merged); kvSet('feed2', merged);
    }
    if (st.data) {
      const g = {}; st.data.forEach((x) => (g[x.user_id] ||= []).push(x));
      setGroups(Object.values(g).sort((a, b) => (b[0].user_id === me) - (a[0].user_id === me)));
    }
  }, [me]);

  useEffect(() => { load(); return navigation.addListener('focus', load); }, [load]);
  useEffect(() => onSync((t) => { if (t === 'post' || t === 'story') load(); }), [load]);
  useEffect(() => navigation.setOptions({
    headerLeft:  () => <Ionicons name="add-outline"       size={30} color="#fff" onPress={() => navigation.navigate('Create')} />,
    headerRight: () => <Ionicons name="paper-plane-outline" size={26} color="#fff" onPress={() => navigation.navigate('Inbox')} />,
  }), []);

  const openPost    = useCallback((id) => navigation.navigate('PostDetail',   { id }), [navigation]);
  const openReel    = useCallback((id) => navigation.navigate('ReelDetail',   { id }), [navigation]);
  const openProfile = useCallback((id) => navigation.navigate('UserProfile',  { id }), [navigation]);

  return (
    <>
      <FlatList data={items} onRefresh={load} refreshing={false} keyExtractor={(x) => x.kind + x.id}
        windowSize={5} maxToRenderPerBatch={4} initialNumToRender={3} removeClippedSubviews
        ListHeaderComponent={
          <FlatList horizontal data={groups} keyExtractor={(g) => g[0].user_id} style={{ padding: 8 }}
            renderItem={({ item, index }) => {
              const seen = item.every((x) => isSeen(x.id));
              return (
                <TouchableOpacity onPress={() => setOpen({ gIdx: index })} style={{ alignItems: 'center', marginRight: 12 }}>
                  <View style={[s.av, { borderColor: seen ? '#555' : '#e1306c' }]}>
                    <CachedImage uri={item[item.length - 1].image_url} style={s.avImg} />
                  </View>
                  <Text numberOfLines={1} style={{ maxWidth: 68, fontSize: 11 }}>
                    {item[0].user_id === me ? 'Tu historia' : item[0].profiles?.username}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        }
        renderItem={({ item }) =>
          item.kind === 'reel'
            ? <ReelCard item={item} onOpen={openReel} onProfile={openProfile} />
            : <PostCard post={item} me={me} onOpen={openPost} onProfile={openProfile} />
        }
      />

      {open != null && (
        <StoryViewer
          groups={groups}
          initialGroup={open.gIdx}
          onClose={() => { setOpen(null); force((x) => x + 1); }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  av:   { width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: '#262626', alignItems: 'center', justifyContent: 'center' },
  avImg:{ width: 58, height: 58, borderRadius: 29 },
  user: { fontWeight: '700', padding: 10 },
  txt:  { paddingHorizontal: 10 },
});