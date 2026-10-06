import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  Alert,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabase';
import { enqueue, uuid } from '../offline';
import { C, Text, TextInput } from '../ui';
import CachedImage from '../CachedImage';

// Constantes de estilo ajustables para el Chat
const CHAT_BG = '#062a3f'; // Azul oscuro verdoso del chat
const BUBBLE_ME = '#12f58a'; // Verde menta brillante para mis mensajes
const BUBBLE_PEER = '#3a4052'; // Gris azulado para el otro
const TEXT_ME = '#000000';
const TEXT_PEER = '#ffffff';
const ACCENT_BLUE = '#0095f6';

// Helper para formato de tiempo relativo ("44 min", "1 h", "3 d")
function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (new Date() - new Date(dateStr)) / 1000; // segundos
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return `${Math.floor(diff / 86400)} d`;
}

// Verifica si un texto son únicamente 1 a 3 emojis
function isOnlyEmoji(str) {
  if (!str) return false;
  const clean = str.trim();
  const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]){1,3}$/;
  return emojiRegex.test(clean);
}

// Componente para la pantalla BANDEJA DE ENTRADA (Inbox)
export function Inbox({ navigation, me }) {
  const [myProfile, setMyProfile] = useState(null);
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [userSearchText, setUserSearchText] = useState('');

  // Cargar perfil actual del usuario
  useEffect(() => {
    supabase.from('profiles').select('username, avatar_url').eq('id', me).single().then((r) => {
      if (r.data) setMyProfile(r.data);
    });
  }, [me]);

  // Cargar conversaciones
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`sender.eq.${me},receiver.eq.${me}`)
      .order('created_at', { ascending: false })
      .limit(500);

    const last = {};
    (data || []).forEach((m) => {
      const peer = m.sender === me ? m.receiver : m.sender;
      last[peer] ||= m;
    });

    const ids = Object.keys(last);
    const pr = ids.length ? (await supabase.from('profiles').select('id,username,avatar_url').in('id', ids)).data : [];
    const profilesMap = Object.fromEntries((pr || []).map((p) => [p.id, p]));

    const list = Object.entries(last).map(([peer, m]) => ({
      peer,
      m,
      name: profilesMap[peer]?.username || 'Usuario',
      avatar_url: profilesMap[peer]?.avatar_url
    })).sort((a, b) => b.m.created_at.localeCompare(a.m.created_at));

    setRows(list);
  }, [me]);

  useEffect(() => {
    load();
    const f = navigation.addListener('focus', load);
    const ch = supabase
      .channel('inbox-' + me)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver=eq.${me}` },
        async (e) => {
          await supabase.from('messages').update({ delivered_at: new Date().toISOString() }).eq('id', e.new.id);
          load();
        }
      )
      .subscribe();

    return () => {
      f();
      supabase.removeChannel(ch);
    };
  }, [load, me, navigation]);

  // Búsqueda de nuevos usuarios para redactar chat
  const openNewChatModal = async () => {
    setSearchModalVisible(true);
    const { data } = await supabase.from('profiles').select('id,username,avatar_url').neq('id', me).limit(50);
    setAllUsers(data || []);
  };

  const handleSelectUser = (user) => {
    setSearchModalVisible(false);
    navigation.navigate('Chat', { peer: user.id, name: user.username });
  };

  // Filtrado de la bandeja por búsqueda
  const filteredRows = rows.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <View style={styles.inboxContainer}>
      {/* Encabezado Superior */}
      <View style={styles.inboxHeader}>
        <TouchableOpacity style={styles.usernameSelector}>
          <Text style={styles.headerUsername}>{myProfile?.username || 'mi_usuario'}</Text>
          <Ionicons name="chevron-down" size={16} color="#fff" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openNewChatModal} style={styles.iconButton}>
          <Ionicons name="create-outline" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Barra de búsqueda */}
      <View style={styles.searchBarContainer}>
        <Ionicons name="search-outline" size={18} color="#8e8e93" style={styles.searchIcon} />
        <TextInput
          placeholder="Buscar"
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Carrete horizontal de "Notas" */}
        <View style={styles.notesSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.notesScroll}>
            {rows.map((item) => {
              const preview = item.m.body || '📷 Foto';
              const bubbleText = preview.length > 12 ? preview.substring(0, 12) + '...' : preview;
              return (
                <TouchableOpacity
                  key={item.peer}
                  style={styles.noteItem}
                  onPress={() => navigation.navigate('Chat', { peer: item.peer, name: item.name })}
                >
                  <View style={styles.noteBubble}>
                    <Text style={styles.noteBubbleText} numberOfLines={1}>
                      {bubbleText}
                    </Text>
                  </View>
                  <View style={styles.noteAvatarContainer}>
                    {item.avatar_url ? (
                      <CachedImage uri={item.avatar_url} style={styles.noteAvatar} />
                    ) : (
                      <View style={[styles.noteAvatar, { backgroundColor: '#333' }]} />
                    )}
                  </View>
                  <Text style={styles.noteName} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Encabezado de la lista Mensajes / Solicitudes */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleLeft}>Mensajes</Text>
          <TouchableOpacity>
            <Text style={styles.sectionTitleRight}>Solicitudes</Text>
          </TouchableOpacity>
        </View>

        {/* Lista de Conversaciones */}
        {filteredRows.map((item) => {
          const isMe = item.m.sender === me;
          const isUnread = !isMe && !item.m.read_at;
          const timeAgo = formatTimeAgo(item.m.created_at);

          let subtitle = '';
          if (isMe) {
            if (!item.m.read_at) {
              subtitle = `Enviado hace ${timeAgo}`;
            } else {
              subtitle = `Tú: ${item.m.body} · ${timeAgo}`;
            }
          } else {
            subtitle = `${item.m.body} · ${timeAgo}`;
          }

          return (
            <TouchableOpacity
              key={item.peer}
              style={styles.chatRow}
              onPress={() => navigation.navigate('Chat', { peer: item.peer, name: item.name })}
            >
              {item.avatar_url ? (
                <CachedImage uri={item.avatar_url} style={styles.rowAvatar} />
              ) : (
                <View style={[styles.rowAvatar, { backgroundColor: '#333' }]} />
              )}

              <View style={styles.rowTextContainer}>
                <Text style={[styles.rowName, isUnread && styles.unreadText]}>{item.name}</Text>
                <Text style={[styles.rowSubtitle, isUnread && styles.unreadSubtitle]} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>

              {isUnread && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Modal para redactar/iniciar nuevo chat */}
      <Modal visible={searchModalVisible} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo mensaje</Text>
            <TouchableOpacity onPress={() => setSearchModalVisible(false)}>
              <Text style={{ color: ACCENT_BLUE, fontSize: 16, fontWeight: '600' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            placeholder="Buscar usuario..."
            value={userSearchText}
            onChangeText={setUserSearchText}
            style={styles.modalInput}
          />
          <FlatList
            data={allUsers.filter((u) => u.username.toLowerCase().includes(userSearchText.toLowerCase()))}
            keyExtractor={(u) => u.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.userSelectItem} onPress={() => handleSelectUser(item)}>
                {item.avatar_url ? (
                  <CachedImage uri={item.avatar_url} style={styles.userSelectAvatar} />
                ) : (
                  <View style={[styles.userSelectAvatar, { backgroundColor: '#333' }]} />
                )}
                <Text style={{ fontWeight: '600', fontSize: 16 }}>{item.username}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

// Componente para un mensaje individual con gesto Swipe to Reply
function MessageItem({ item, isMe, showAvatar, peerProfile, replyMsg, onReply }) {
  const panX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 15 && gestureState.dx > 0,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0 && gestureState.dx < 80) {
          panX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 40) {
          onReply(item);
        }
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
      }
    })
  ).current;

  const isEmojiOnly = isOnlyEmoji(item.body);

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{ transform: [{ translateX: panX }], flexDirection: 'row', alignItems: 'flex-end', marginVertical: 2 }}
    >
      {/* Avatar del otro a la izquierda (solo en el último del grupo) */}
      {!isMe && (
        <View style={{ width: 28, height: 28, marginRight: 6 }}>
          {showAvatar &&
            (peerProfile?.avatar_url ? (
              <CachedImage uri={peerProfile.avatar_url} style={styles.smallPeerAvatar} />
            ) : (
              <View style={[styles.smallPeerAvatar, { backgroundColor: '#555' }]} />
            ))}
        </View>
      )}

      <View style={{ flex: 1, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        {/* Vista previa si el mensaje es una respuesta */}
        {replyMsg && (
          <View style={styles.quotedReplyHeader}>
            <Text style={styles.quotedReplyTitle}>Te respondió</Text>
            <View style={styles.quotedReplyContent}>
              <View style={styles.quotedReplyBar} />
              <View
                style={[
                  styles.quotedReplyBubble,
                  { backgroundColor: isMe ? 'rgba(18, 245, 138, 0.4)' : 'rgba(58, 64, 82, 0.6)' }
                ]}
              >
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13 }}>
                  {replyMsg.body}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Burbuja principal de texto o Emoji gigante */}
        {isEmojiOnly ? (
          <Text style={styles.emojiOnlyText}>{item.body}</Text>
        ) : (
          <View
            style={[
              styles.chatBubble,
              {
                backgroundColor: isMe ? BUBBLE_ME : BUBBLE_PEER,
                alignSelf: isMe ? 'flex-end' : 'flex-start'
              }
            ]}
          >
            <Text style={{ color: isMe ? TEXT_ME : TEXT_PEER, fontSize: 15 }}>{item.body}</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// Componente para la pantalla de CHAT INDIVIDUAL
export function Chat({ route, navigation, me }) {
  const { peer, name } = route.params;
  const [peerProfile, setPeerProfile] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [t, setT] = useState('');
  const [typing, setTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const ch = useRef(null);
  const timer = useRef(null);

  // Ocultar header por defecto de React Navigation para usar encabezado personalizado
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Cargar datos del perfil del receptor
  useEffect(() => {
    supabase.from('profiles').select('id, username, avatar_url').eq('id', peer).single().then((r) => {
      if (r.data) setPeerProfile(r.data);
    });
  }, [peer]);

  // Cargar mensajes y suscripción realtime
  useEffect(() => {
    const markRead = () =>
      supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender', peer).eq('receiver', me).is('read_at', null);

    supabase
      .from('messages')
      .select('*')
      .or(`and(sender.eq.${me},receiver.eq.${peer}),and(sender.eq.${peer},receiver.eq.${me})`)
      .order('created_at')
      .then((r) => {
        setMsgs(r.data || []);
        markRead();
      });

    ch.current = supabase
      .channel('dm-' + [me, peer].sort().join('-'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (e) => {
        const m = e.new;
        if ((m.sender === peer && m.receiver === me) || (m.sender === me && m.receiver === peer)) {
          setMsgs((x) => (x.some((y) => y.id === m.id) ? x.map((y) => (y.id === m.id ? m : y)) : [...x, m]));
          if (m.sender === peer) markRead();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (e) =>
        setMsgs((x) => x.map((y) => (y.id === e.new.id ? e.new : y)))
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.from === peer) {
          setTyping(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setTyping(false), 2000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch.current);
      clearTimeout(timer.current);
    };
  }, [me, peer]);

  // Enviar mensaje
  const send = () => {
    if (!t.trim()) return;
    const m = {
      id: uuid(),
      sender: me,
      receiver: peer,
      body: t.trim(),
      reply_to: replyingTo?.id || null
    };
    setT('');
    setReplyingTo(null);
    setMsgs((x) => [...x, { ...m, created_at: new Date().toISOString(), pending: true }]);
    enqueue('message', m);
  };

  const onType = (v) => {
    setT(v);
    ch.current?.send({ type: 'broadcast', event: 'typing', payload: { from: me } });
  };

  const handlePickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled) {
      Alert.alert('Envío de imagen', 'El envío de archivos multimedia estará disponible en una próxima versión.');
    }
  };

  const handleHeaderProfilePress = () => {
    navigation.navigate('UserProfile', { id: peer });
  };

  // Último mensaje enviado por mí para mostrar estado ("Visto", "Entregado", etc.)
  const myLastMsgIndex = msgs.map((m) => m.sender === me).lastIndexOf(true);

  const getStatusText = (m) => {
    if (m.pending) return 'Enviando…';
    if (m.read_at) return 'Visto';
    if (m.delivered_at) return 'Entregado';
    return 'Enviado';
  };

  return (
    <KeyboardAvoidingView
      style={styles.chatScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Encabezado del Chat */}
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.headerProfile} onPress={handleHeaderProfilePress}>
          {peerProfile?.avatar_url ? (
            <CachedImage uri={peerProfile.avatar_url} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: '#555' }]} />
          )}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.headerName}>{name}</Text>
              <Ionicons name="chevron-forward" size={14} color="#aaa" style={{ marginLeft: 2 }} />
            </View>
            <Text style={styles.headerSubname}>@{peerProfile?.username || name.toLowerCase()}</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => Alert.alert('Llamada', 'Próximamente')} style={{ marginRight: 16 }}>
            <Ionicons name="call-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert('Videollamada', 'Próximamente')}>
            <Ionicons name="videocam-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Lista de Mensajes */}
      <FlatList
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item, index }) => {
          const isMe = item.sender === me;
          const isLastInGroup = index === msgs.length - 1 || msgs[index + 1]?.sender !== item.sender;
          const replyMsg = item.reply_to ? msgs.find((x) => x.id === item.reply_to) : null;

          return (
            <View>
              <MessageItem
                item={item}
                isMe={isMe}
                showAvatar={isLastInGroup}
                peerProfile={peerProfile}
                replyMsg={replyMsg}
                onReply={setReplyingTo}
              />
              {/* Estado del mensaje debajo del último mensaje mío */}
              {isMe && index === myLastMsgIndex && (
                <View style={{ alignItems: 'flex-end', marginTop: 2, marginBottom: 4 }}>
                  <Text style={styles.statusText}>{getStatusText(item)}</Text>
                  {item.read_at && peerProfile?.avatar_url && (
                    <CachedImage uri={peerProfile.avatar_url} style={styles.seenAvatar} />
                  )}
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Indicador de "Escribiendo..." */}
      {typing && (
        <View style={styles.typingContainer}>
          <View style={styles.typingBubble}>
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
          </View>
        </View>
      )}

      {/* Barra de Pre visualización de Respuesta (Swipe to Reply) */}
      {replyingTo && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Respondiendo a:</Text>
            <Text style={{ color: '#ccc', fontSize: 13 }} numberOfLines={1}>
              {replyingTo.body}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)}>
            <Ionicons name="close-circle" size={20} color="#8e8e93" />
          </TouchableOpacity>
        </View>
      )}

      {/* Barra Inferior de Entrada */}
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.cameraCircle} onPress={handlePickImage}>
          <Ionicons name="camera" size={18} color="#000" />
        </TouchableOpacity>

        <TextInput
          value={t}
          onChangeText={onType}
          placeholder="Enviar mensaje…"
          style={styles.chatTextInput}
          multiline={false}
        />

        {t.trim().length > 0 ? (
          <TouchableOpacity onPress={send} style={styles.sendButton}>
            <Text style={styles.sendButtonText}>Enviar</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.inputIconsRight}>
            <TouchableOpacity style={styles.inputIcon}>
              <Ionicons name="mic-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputIcon} onPress={handlePickImage}>
              <Ionicons name="image-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputIcon}>
              <Ionicons name="happy-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// Estilos de la aplicación
const styles = StyleSheet.create({
  // Bandeja (Inbox)
  inboxContainer: {
    flex: 1,
    backgroundColor: C.bg
  },
  inboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 10
  },
  usernameSelector: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  headerUsername: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff'
  },
  iconButton: {
    padding: 4
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 38,
    marginBottom: 12
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0
  },
  notesSection: {
    paddingVertical: 8
  },
  notesScroll: {
    paddingHorizontal: 12
  },
  noteItem: {
    alignItems: 'center',
    marginRight: 16,
    width: 76
  },
  noteBubble: {
    backgroundColor: '#262626',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: -10,
    zIndex: 2,
    maxWidth: 76
  },
  noteBubbleText: {
    fontSize: 11,
    color: '#eee',
    textAlign: 'center'
  },
  noteAvatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  noteAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30
  },
  noteName: {
    fontSize: 12,
    color: '#ccc',
    marginTop: 4,
    textAlign: 'center'
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  sectionTitleLeft: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff'
  },
  sectionTitleRight: {
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT_BLUE
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  rowAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12
  },
  rowTextContainer: {
    flex: 1
  },
  rowName: {
    fontSize: 15,
    color: '#fff',
    marginBottom: 2
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#8e8e93'
  },
  unreadText: {
    fontWeight: '700'
  },
  unreadSubtitle: {
    color: '#fff',
    fontWeight: '600'
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT_BLUE,
    marginLeft: 8
  },

  // Modal Nuevo Chat
  modalContainer: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: 50,
    paddingHorizontal: 16
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700'
  },
  modalInput: {
    padding: 12,
    marginBottom: 16
  },
  userSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10
  },
  userSelectAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12
  },

  // Pantalla Chat
  chatScreen: {
    flex: 1,
    backgroundColor: CHAT_BG
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'android' ? 40 : 12,
    paddingBottom: 10,
    backgroundColor: CHAT_BG,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.1)'
  },
  backButton: {
    paddingRight: 8
  },
  headerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 8
  },
  headerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff'
  },
  headerSubname: {
    fontSize: 11,
    color: '#aaa'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center'
  },

  // Mensajes y Burbujas
  chatBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: '75%'
  },
  emojiOnlyText: {
    fontSize: 44,
    marginVertical: 4
  },
  smallPeerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14
  },

  // Respuestas (Reply To)
  quotedReplyHeader: {
    marginBottom: 4,
    maxWidth: '75%'
  },
  quotedReplyTitle: {
    fontSize: 11,
    color: '#aaa',
    marginBottom: 2
  },
  quotedReplyContent: {
    flexDirection: 'row',
    alignItems: 'stretch'
  },
  quotedReplyBar: {
    width: 3,
    backgroundColor: '#8e8e93',
    borderRadius: 2,
    marginRight: 6
  },
  quotedReplyBubble: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12
  },

  // Estado del mensaje
  statusText: {
    fontSize: 10,
    color: '#aaa',
    marginTop: 1
  },
  seenAvatar: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 2
  },

  // Indicador Escribiendo
  typingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6
  },
  typingBubble: {
    flexDirection: 'row',
    backgroundColor: BUBBLE_PEER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    alignSelf: 'flex-start',
    gap: 4
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#aaa'
  },

  // Barra de respuesta encima del Input
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },

  // Barra de entrada (Input Box)
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 12,
    marginBottom: Platform.OS === 'ios' ? 20 : 10,
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  cameraCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: BUBBLE_ME,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 4
  },
  sendButton: {
    paddingHorizontal: 12
  },
  sendButtonText: {
    color: ACCENT_BLUE,
    fontWeight: '700',
    fontSize: 15
  },
  inputIconsRight: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  inputIcon: {
    paddingHorizontal: 6
  }
});