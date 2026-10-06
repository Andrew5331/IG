import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { supabase } from './src/supabase';
import { startSync, flush } from './src/offline';
import { Text, TextInput, Button, C } from './src/ui';
import Feed from './src/screens/Feed';
import { PostDetail, Create } from './src/screens/Post';
import { Explore, Activity, Profile, UserProfile, FollowList, EditProfile } from './src/screens/Social';
import { Inbox, Chat } from './src/screens/Chat';
import { Reels, CreateReel, ReelDetail } from './src/screens/Reels';

const Tab = createBottomTabNavigator(); const Stack = createNativeStackNavigator();
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, border: C.border, primary: '#fff', text: '#fff' } };
const ICONS = { Home: ['home', 'home-outline'], Explorar: ['search', 'search-outline'], Reels: ['play-circle', 'play-circle-outline'], Actividad: ['heart', 'heart-outline'], Perfil: ['person-circle', 'person-circle-outline'] };
// Cada pestaña = su propio Stack (pila independiente).
const mk = (me, screens) => function StackScreenGroup() {
  return (
    <Stack.Navigator>
      {screens.map(([n, Component, o]) => (
        <Stack.Screen key={n} name={n} options={o}>
          {(p) => <Component {...p} me={me} />}
        </Stack.Screen>
      ))}
    </Stack.Navigator>
  );
};

function Auth() {
  const [e, setE] = useState(''); const [p, setP] = useState(''); const [msg, setMsg] = useState('');
  const go = async (up) => { const r = await (up ? supabase.auth.signUp({ email: e, password: p }) : supabase.auth.signInWithPassword({ email: e, password: p })); if (r.error) setMsg(r.error.message); };
  return (<View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 10, backgroundColor: C.bg }}>
    <Text style={{ fontSize: 42, fontWeight: '800', textAlign: 'center', marginBottom: 20 }}>SocIAl</Text>
    <TextInput placeholder="Email" autoCapitalize="none" value={e} onChangeText={setE} style={{ padding: 12 }} />
    <TextInput placeholder="Contraseña" secureTextEntry value={p} onChangeText={setP} style={{ padding: 12 }} />
    <Button title="Entrar" onPress={() => go(false)} /><Button title="Crear cuenta" color="#555" onPress={() => go(true)} /><Text style={{ color: '#ff6b6b' }}>{msg}</Text></View>);
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then((r) => setSession(r.data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const unsub = startSync(); flush();
    return () => { data.subscription.unsubscribe(); unsub(); };
  }, []);
  if (session === undefined) return null;
  if (!session) return (<><StatusBar style="light" /><Auth /></>);
  const me = session.user.id;
  const shared = [['PostDetail', PostDetail, { title: 'Publicación' }], ['Chat', Chat, {}], ['UserProfile', UserProfile, { title: 'Perfil' }], ['FollowList', FollowList, {}], ['ReelDetail', ReelDetail, { title: 'Reel' }]];
  const Home = mk(me, [['Feed', Feed, { title: 'SocIAl', headerTitleStyle: { fontSize: 24, fontWeight: '800' } }], ['Create', Create, { title: 'Nueva' }], ['Inbox', Inbox, { title: 'Mensajes' }], ...shared]);
  const Exp = mk(me, [['Explore', Explore, { title: 'Explorar' }], ...shared]);
  const Rl = mk(me, [['ReelsFeed', Reels, { title: 'Reels' }], ['CreateReel', CreateReel, { title: 'Nuevo reel' }]]);
  const Act = mk(me, [['Activity', Activity, { title: 'Actividad' }]]);
  const Perf = mk(me, [['Profile', Profile, { title: 'Perfil' }], ['EditProfile', EditProfile, { title: 'Editar perfil' }], ...shared]);
  const linking = { prefixes: [Linking.createURL('/'), 'instagramclone://'], config: { screens: { Home: { screens: { PostDetail: 'post/:id' } } } } };
  return (<>
    <StatusBar style="light" />
    <NavigationContainer linking={linking} theme={theme}>
      <Tab.Navigator screenOptions={({ route }) => ({
        headerShown: false, tabBarShowLabel: false, tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.border },
        tabBarIcon: ({ focused, size }) => <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size + 2} color="#fff" />,
      })}>
        <Tab.Screen name="Home" component={Home} /><Tab.Screen name="Explorar" component={Exp} /><Tab.Screen name="Reels" component={Rl} /><Tab.Screen name="Actividad" component={Act} /><Tab.Screen name="Perfil" component={Perf} />
      </Tab.Navigator>
    </NavigationContainer>
  </>);
}