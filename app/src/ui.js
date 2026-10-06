import React from 'react';
import { Text as RNText, TextInput as RNTextInput, Pressable } from 'react-native';
export const C = { bg: '#000', card: '#121212', input: '#262626', border: '#262626', text: '#fff', sub: '#a8a8a8', blue: '#0095f6', btn: '#363636' };
export const Text = ({ style, ...p }) => <RNText {...p} style={[{ color: C.text }, style]} />;
export const TextInput = ({ style, ...p }) => <RNTextInput placeholderTextColor={C.sub} {...p} style={[{ color: C.text, backgroundColor: C.input, borderRadius: 8 }, style]} />;
// Mismo uso que el Button de React Native. kind: 'primary' (azul) | 'secondary' (gris) | 'danger' (texto rojo)
export const Button = ({ title, onPress, color, kind, disabled, style }) => {
  const k = kind || (color === '#c00' ? 'danger' : color ? 'secondary' : 'primary');
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [{ backgroundColor: k === 'primary' ? C.blue : C.btn, opacity: disabled ? 0.4 : pressed ? 0.7 : 1, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, style]}>
      <RNText style={{ color: k === 'danger' ? '#ff4d5a' : '#fff', fontWeight: '600' }}>{title}</RNText>
    </Pressable>
  );
};