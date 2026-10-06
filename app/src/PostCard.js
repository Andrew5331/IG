import React, { useState, memo } from 'react';
import { View, TouchableOpacity, Share, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import CachedImage from './CachedImage';
import { enqueue } from './offline';
import { Text } from './ui';

const W = Dimensions.get('window').width;

function PostCard({ post, me, onOpen, onProfile }) {
  const [liked, setLiked] = useState(post.likes.some((l) => l.user_id === me));
  const [n, setN] = useState(post.likes.length);
  const [saved, setSaved] = useState(false);

  const toggle = () => {
    const next = !liked;
    setLiked(next);
    setN(n + (next ? 1 : -1));
    enqueue(next ? 'like' : 'unlike', { post_id: post.id, user_id: me });
  };

  const av = { width: 34, height: 34, borderRadius: 17 };

  return (
    <View style={{ marginBottom: 14, borderBottomWidth: 0.5, borderColor: '#1f1f1f', paddingBottom: 10 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 }}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => onProfile?.(post.user_id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ borderRadius: 19, padding: 1.5, borderWidth: post.profiles?.avatar_url ? 1.5 : 0, borderColor: '#e1306c' }}>
            {post.profiles?.avatar_url ? <CachedImage uri={post.profiles.avatar_url} style={av} /> : <View style={[av, { backgroundColor: '#262626' }]} />}
          </View>
          <Text style={{ fontWeight: '700', fontSize: 14 }}>{post.profiles?.username}</Text>
        </TouchableOpacity>
        <Ionicons name="ellipsis-horizontal" size={20} color="#8e8e8e" />
      </View>

      {/* Media */}
      <CachedImage uri={post.image_url} style={{ width: W, height: W }} />

      {/* Action Bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <TouchableOpacity onPress={toggle} activeOpacity={0.6}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={26} color={liked ? '#ff3040' : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onOpen?.(post.id)} activeOpacity={0.6}>
            <Ionicons name="chatbubble-outline" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Share.share({ message: Linking.createURL('post/' + post.id) })} activeOpacity={0.6}>
            <Ionicons name="paper-plane-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setSaved(!saved)} activeOpacity={0.6}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Info Section */}
      <View style={{ paddingHorizontal: 12 }}>
        <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 3 }}>{n.toLocaleString()} Me gusta</Text>
        {!!post.caption && (
          <Text style={{ fontSize: 14, lineHeight: 18 }}>
            <Text style={{ fontWeight: '700' }}>{post.profiles?.username} </Text>
            {post.caption}
          </Text>
        )}
      </View>
    </View>
  );
}

export default memo(PostCard);