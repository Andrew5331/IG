import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { getImage } from './imageCache';
export default function CachedImage({ uri, style }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const ctl = new AbortController(); // se cancela al salir del viewport (la celda se desmonta/recicla)
    setSrc(null);
    if (uri) getImage(uri, ctl.signal).then((p) => !ctl.signal.aborted && setSrc(p)).catch((e) => e.message !== 'cancelled' && console.warn('[img]', e.message));
    return () => ctl.abort();
  }, [uri]);
  return src ? <Image source={{ uri: src }} style={style} onError={(e) => console.warn('[img] no se pudo mostrar', src, e.nativeEvent?.error)} /> : <View style={[style, { backgroundColor: '#262626' }]} />;
}