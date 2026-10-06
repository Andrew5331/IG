import * as Linking from 'expo-linking';
import { supabase } from './supabase';
// En Expo Go (misma red Wi-Fi) la IP de tu PC se deduce sola. Si usas túnel, define EXPO_PUBLIC_API_URL en app/.env.
const guess = () => { const m = Linking.createURL('/').match(/^exp:\/\/(\d+\.\d+\.\d+\.\d+)/); return m ? `http://${m[1]}:3000` : null; };
export const API_URL = process.env.EXPO_PUBLIC_API_URL || guess() || 'http://TU_IP_LOCAL:3000';
export async function api(path, method = 'GET', body) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
