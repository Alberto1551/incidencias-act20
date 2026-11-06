// Actividad 20 - Almacenamiento en la nube para archivos multimedia
// Servicio: Supabase Storage (bucket PRIVADO) + tabla "incidencias" con RLS
import { useEffect, useState, useCallback } from 'react';
import {
  View, ScrollView, Text, TextInput, Pressable, Image, ActivityIndicator,
  StyleSheet, Switch, Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase, BUCKET, SUPABASE_PUBLIC_URL } from './lib/supabase';

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANO_MAX = 5 * 1024 * 1024; // 5 MB
const EXPIRACION_URL = 60 * 60;     // URL firmada válida 1 hora

const EXT_A_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };
const MIME_A_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const C = {
  fondo: '#F4F5F9', tinta: '#141A33', gris: '#667085', borde: '#E4E7EC',
  primario: '#F2542D', primario2: '#F79824', suave: '#FFF3EE',
  ok: '#12B76A', error: '#F04438',
};

function obtenerMime(asset) {
  if (asset.mimeType) return asset.mimeType;
  const ext = (asset.fileName ?? asset.uri).split('.').pop().toLowerCase();
  return EXT_A_MIME[ext] ?? 'application/octet-stream';
}

function validarArchivo(mime, bytes) {
  if (!bytes) return 'El archivo está vacío.';
  if (!TIPOS_PERMITIDOS.includes(mime)) return `Formato no permitido (${mime}). Solo se aceptan JPG, PNG o WEBP.`;
  if (bytes > TAMANO_MAX) return `El archivo pesa ${(bytes / 1048576).toFixed(1)} MB; el máximo permitido es 5 MB.`;
  return null;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function tiempoRelativo(fecha) {
  const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60000);
  if (min < 1) return 'Justo ahora';
  if (min < 60) return `Hace ${min} min`;
  if (min < 1440) return `Hace ${Math.round(min / 60)} h`;
  const d = new Date(fecha);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}
function fechaCompleta(fecha) {
  const d = new Date(fecha);
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [errorSesion, setErrorSesion] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imagen, setImagen] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null); // { ok, mensaje, path?, url? }
  const [incidencias, setIncidencias] = useState([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [omitirValidacion, setOmitirValidacion] = useState(false);
  const [verPruebas, setVerPruebas] = useState(false);
  const [detalle, setDetalle] = useState(null);

  // ---- Sesión: usuario anónimo persistente (el mismo al cerrar y abrir la app) ----
  useEffect(() => {
    (async () => {
      try {
        let { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          session = data.session;
        }
        setUsuario(session.user);
      } catch (e) {
        setErrorSesion(e.message);
        setCargandoLista(false);
      }
    })();
  }, []);

  // ---- Consulta: incidencias guardadas + URL firmada de cada imagen ----
  const cargarIncidencias = useCallback(async () => {
    setCargandoLista(true);
    try {
      const { data, error } = await supabase
        .from('incidencias').select('id, titulo, descripcion, imagen_path, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data.length === 0) { setIncidencias([]); return; }
      const { data: firmadas, error: e2 } = await supabase.storage
        .from(BUCKET).createSignedUrls(data.map((i) => i.imagen_path), EXPIRACION_URL);
      if (e2) throw e2;
      setIncidencias(data.map((inc, i) => ({ ...inc, url: firmadas[i]?.signedUrl })));
    } catch (e) {
      Alert.alert('No se pudieron cargar las incidencias', e.message);
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => { if (usuario) cargarIncidencias(); }, [usuario, cargarIncidencias]);

  // ---- Selección de imagen ----
  async function elegirDeGaleria(cualquierMedio = false) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permiso denegado', 'Se necesita acceso a la galería para adjuntar la fotografía.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: cualquierMedio ? ['images', 'videos'] : ['images'],
      quality: 0.7,
    });
    if (!r.canceled) { setImagen(r.assets[0]); setResultado(null); }
  }

  async function tomarFoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permiso denegado', 'Se necesita acceso a la cámara para fotografiar la incidencia.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!r.canceled) { setImagen(r.assets[0]); setResultado(null); }
  }

  // ---- Carga a la nube ----
  async function subirIncidencia() {
    if (titulo.trim().length < 3) { setResultado({ ok: false, mensaje: 'Escribe un título de al menos 3 caracteres.' }); return; }
    if (!imagen) { setResultado({ ok: false, mensaje: 'Agrega una fotografía de la incidencia.' }); return; }

    setSubiendo(true); setResultado(null);
    try {
      const red = await Network.getNetworkStateAsync();
      if (!red.isConnected || red.isInternetReachable === false) {
        throw new Error('Sin conexión a internet. Revisa tu red e inténtalo de nuevo.');
      }

      let mime = obtenerMime(imagen);
      let buffer;
      if (omitirValidacion) {
        // Prueba: se envía el archivo original sin validar para comprobar que el servidor lo rechaza
        buffer = await new File(imagen.uri).arrayBuffer();
      } else {
        const error = validarArchivo(mime, imagen.fileSize ?? 1);
        if (error) throw new Error(error);
        // Se reduce la foto a 1280 px de ancho y se convierte a JPEG (menos datos y carga más rápida)
        const ctx = ImageManipulator.manipulate(imagen.uri);
        if ((imagen.width ?? 0) > 1280) ctx.resize({ width: 1280 });
        const img = await ctx.renderAsync();
        const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
        buffer = decode(res.base64);   // base64 -> ArrayBuffer (método recomendado por Supabase para Expo)
        mime = 'image/jpeg';
        const error2 = validarArchivo(mime, buffer.byteLength);
        if (error2) throw new Error(error2);
      }
      if (!buffer || buffer.byteLength === 0) throw new Error('No se pudo leer la imagen seleccionada. Elige otra foto.');

      // Ruta: <id del usuario>/<marca de tiempo>.<ext>  -> las políticas solo permiten la carpeta propia
      const ext = MIME_A_EXT[mime] ?? (imagen.uri.split('.').pop() || 'bin');
      const path = `${usuario.id}/${Date.now()}.${ext}`;

      const { error: errSubida } = await supabase.storage.from(BUCKET)
        .upload(path, buffer, { contentType: mime, upsert: false });
      if (errSubida) throw new Error(`El servidor rechazó el archivo: ${errSubida.message}`);

      // En la base de datos se guarda solo la referencia (ruta), no la imagen
      const { error: errBD } = await supabase.from('incidencias')
        .insert({ titulo: titulo.trim(), descripcion: descripcion.trim(), imagen_path: path });
      if (errBD) throw errBD;

      const { data: firmada } = await supabase.storage.from(BUCKET).createSignedUrl(path, EXPIRACION_URL);
      setResultado({
        ok: true, mensaje: 'La incidencia se registró y la fotografía quedó almacenada en la nube.',
        path, url: firmada?.signedUrl, kb: Math.max(1, Math.round(buffer.byteLength / 1024)), mime,
      });
      setTitulo(''); setDescripcion(''); setImagen(null);
      cargarIncidencias();
    } catch (e) {
      const msg = /network request failed|failed to fetch/i.test(e.message ?? '') ? 'Se perdió la conexión durante la carga. Inténtalo de nuevo.' : e.message;
      setResultado({ ok: false, mensaje: msg });
    } finally {
      setSubiendo(false);
    }
  }

  // ---- Prueba: acceso sin autorización a un archivo privado ----
  async function probarAccesoPublico(path) {
    const url = `${SUPABASE_PUBLIC_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    try {
      const r = await fetch(url);
      Alert.alert('Acceso sin autorización',
        r.ok ? `El archivo es público (HTTP ${r.status}). Revisa la configuración del bucket.`
             : `Acceso denegado (HTTP ${r.status}). El archivo es privado y solo se puede ver con una URL firmada.`);
    } catch (e) { Alert.alert('Error', e.message); }
  }

  const conectado = !!usuario;

  return (
    <View style={st.raiz}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Encabezado */}
          <LinearGradient colors={[C.primario, C.primario2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.header}>
            <View style={st.headerDeco} />
            <View style={st.fila}>
              <View style={st.headerLogo}><Ionicons name="construct" size={22} color={C.primario} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.headerSub}>Mantenimiento de instalaciones</Text>
                <Text style={st.headerTitulo}>Reportar incidencia</Text>
              </View>
            </View>
            <View style={st.headerFila}>
              <Pill icono="documents-outline" texto={`${incidencias.length} reportes`} />
              <Pill icono="cloud-outline" texto="Supabase Storage" />
              <Pill icono={conectado ? 'radio-button-on' : errorSesion ? 'alert-circle' : 'ellipsis-horizontal'}
                texto={conectado ? 'Conectado' : errorSesion ? 'Sin sesión' : 'Conectando'} colorIcono={conectado ? '#A6F4C5' : '#fff'} />
            </View>
          </LinearGradient>

          <View style={st.cuerpo}>
            {!!errorSesion && (
              <View style={[st.card, st.cardFlotante, st.avisoError]}>
                <Ionicons name="alert-circle" size={22} color={C.error} />
                <View style={{ flex: 1 }}>
                  <Text style={st.itemTitulo}>No se pudo iniciar sesión</Text>
                  <Text style={st.gris}>{errorSesion}. Verifica el archivo .env y que los inicios de sesión anónimos estén activados en Supabase.</Text>
                </View>
              </View>
            )}

            {/* Formulario */}
            <View style={[st.card, !errorSesion && st.cardFlotante, { gap: 8 }]}>
              <Text style={st.etiqueta}>Título</Text>
              <View style={st.inputFila}>
                <Ionicons name="create-outline" size={18} color={C.gris} />
                <TextInput style={st.input} placeholder="Ej. Fuga de agua en baño 2" placeholderTextColor="#98A2B3"
                  value={titulo} onChangeText={setTitulo} maxLength={100} />
              </View>
              <Text style={st.etiqueta}>Descripción</Text>
              <View style={[st.inputFila, { alignItems: 'flex-start' }]}>
                <Ionicons name="reader-outline" size={18} color={C.gris} style={{ marginTop: 12 }} />
                <TextInput style={[st.input, { height: 84 }]} placeholder="¿Qué ocurrió y en qué lugar?" placeholderTextColor="#98A2B3"
                  value={descripcion} onChangeText={setDescripcion} multiline />
              </View>

              <Text style={st.etiqueta}>Evidencia fotográfica</Text>
              {imagen ? (
                <View>
                  <Image source={{ uri: imagen.uri }} style={st.preview} />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={st.previewSombra} />
                  <View style={st.previewInfo}>
                    <Ionicons name="image-outline" size={14} color="#fff" />
                    <Text style={st.previewInfoTxt}>
                      {obtenerMime(imagen).replace('image/', '').toUpperCase()}
                      {imagen.fileSize ? ` · ${(imagen.fileSize / 1024).toFixed(0)} KB` : ''}
                      {imagen.width ? ` · ${imagen.width}×${imagen.height}` : ''}
                    </Text>
                  </View>
                  <Pressable style={st.quitar} onPress={() => setImagen(null)} hitSlop={8}>
                    <Ionicons name="close" size={18} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <View style={st.zonaFoto}>
                  <View style={st.zonaIcono}><Ionicons name="camera-outline" size={30} color={C.primario} /></View>
                  <Text style={st.zonaTitulo}>Agrega una foto del problema</Text>
                  <Text style={st.gris}>JPG, PNG o WEBP · máximo 5 MB</Text>
                </View>
              )}
              <View style={st.fila}>
                <BotonSec icono="images-outline" texto="Galería" onPress={() => elegirDeGaleria(false)} />
                <BotonSec icono="camera-outline" texto="Cámara" onPress={tomarFoto} />
              </View>

              <Pressable onPress={subirIncidencia} disabled={subiendo || !conectado} style={{ opacity: subiendo || !conectado ? 0.6 : 1, marginTop: 6 }}>
                <LinearGradient colors={[C.primario, C.primario2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.botonPrin}>
                  {subiendo ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                      <Text style={st.botonPrinTxt}>Enviar reporte</Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
              {subiendo && (
                <View style={[st.fila, { justifyContent: 'center', gap: 6 }]}>
                  <Ionicons name="lock-closed-outline" size={13} color={C.gris} />
                  <Text style={st.gris}>Subiendo la imagen por una conexión cifrada (HTTPS)…</Text>
                </View>
              )}

              {resultado && (
                <View style={[st.resultado, { backgroundColor: resultado.ok ? '#ECFDF3' : '#FEF3F2', borderColor: resultado.ok ? '#ABEFC6' : '#FECDCA' }]}>
                  <View style={st.fila}>
                    <Ionicons name={resultado.ok ? 'checkmark-circle' : 'close-circle'} size={22} color={resultado.ok ? C.ok : C.error} />
                    <Text style={[st.itemTitulo, { color: resultado.ok ? '#067647' : '#B42318' }]}>
                      {resultado.ok ? 'Carga exitosa' : 'No se pudo enviar'}
                    </Text>
                  </View>
                  <Text style={{ color: C.tinta, lineHeight: 20 }}>{resultado.mensaje}</Text>
                  {!!resultado.path && <InfoFila icono="folder-open-outline" texto={`${BUCKET}/${resultado.path}`} />}
                  {!!resultado.kb && <InfoFila icono="document-outline" texto={`${resultado.mime} · ${resultado.kb} KB`} />}
                  {!!resultado.url && <InfoFila icono="link-outline" texto={resultado.url} lineas={2} />}
                </View>
              )}
            </View>

            {/* Lista */}
            <View style={st.seccionFila}>
              <Text style={st.seccion}>Mis reportes</Text>
              <Pressable onPress={cargarIncidencias} style={st.fila} hitSlop={8}>
                <Ionicons name="refresh" size={16} color={C.primario} />
                <Text style={st.link}>Actualizar</Text>
              </Pressable>
            </View>

            {cargandoLista ? <ActivityIndicator color={C.primario} style={{ marginVertical: 24 }} /> : incidencias.length === 0 ? (
              <View style={[st.card, { alignItems: 'center', paddingVertical: 30, gap: 8 }]}>
                <View style={st.zonaIcono}><Ionicons name="file-tray-outline" size={28} color={C.primario} /></View>
                <Text style={st.zonaTitulo}>Aún no hay reportes</Text>
                <Text style={st.gris}>Las incidencias que envíes aparecerán aquí.</Text>
              </View>
            ) : incidencias.map((inc) => (
              <Pressable key={inc.id} onPress={() => setDetalle(inc)} style={({ pressed }) => [st.card, { padding: 0, overflow: 'hidden' }, pressed && { opacity: 0.9 }]}>
                {inc.url ? <Image source={{ uri: inc.url }} style={st.foto} /> : <View style={[st.foto, { backgroundColor: '#E4E7EC' }]} />}
                <View style={st.chipPrivado}>
                  <Ionicons name="lock-closed" size={11} color="#fff" />
                  <Text style={st.chipPrivadoTxt}>Privado</Text>
                </View>
                <View style={{ padding: 14, gap: 4 }}>
                  <View style={st.seccionFila}>
                    <Text style={[st.itemTitulo, { flex: 1 }]} numberOfLines={1}>{inc.titulo}</Text>
                    <Text style={st.gris}>{tiempoRelativo(inc.created_at)}</Text>
                  </View>
                  {!!inc.descripcion && <Text style={{ color: C.gris, lineHeight: 20 }} numberOfLines={2}>{inc.descripcion}</Text>}
                  <Pressable onPress={() => probarAccesoPublico(inc.imagen_path)} style={[st.fila, { marginTop: 6, gap: 6 }]} hitSlop={6}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={C.primario} />
                    <Text style={[st.link, { fontSize: 13 }]}>Probar acceso sin autorización</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}

            {/* Pruebas */}
            <Pressable style={[st.card, st.seccionFila]} onPress={() => setVerPruebas(!verPruebas)}>
              <View style={[st.fila, { gap: 10 }]}>
                <View style={[st.zonaIcono, { width: 36, height: 36 }]}><Ionicons name="flask-outline" size={18} color={C.primario} /></View>
                <View>
                  <Text style={st.itemTitulo}>Pruebas de seguridad</Text>
                  <Text style={st.gris}>Formato no permitido y validación del servidor</Text>
                </View>
              </View>
              <Ionicons name={verPruebas ? 'chevron-up' : 'chevron-down'} size={20} color={C.gris} />
            </Pressable>
            {verPruebas && (
              <View style={[st.card, { gap: 12 }]}>
                <View style={st.seccionFila}>
                  <Text style={{ flex: 1, color: C.tinta, lineHeight: 20 }}>Omitir la validación local para comprobar que el servidor también rechaza el archivo</Text>
                  <Switch value={omitirValidacion} onValueChange={setOmitirValidacion} trackColor={{ true: C.primario }} />
                </View>
                <BotonSec icono="film-outline" texto="Elegir video o GIF (formato no permitido)" onPress={() => elegirDeGaleria(true)} />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Detalle de la incidencia */}
      <Modal visible={!!detalle} animationType="slide" transparent onRequestClose={() => setDetalle(null)}>
        <View style={st.modalFondo}>
          <View style={st.modal}>
            {detalle && (
              <>
                {!!detalle.url && <Image source={{ uri: detalle.url }} style={st.modalFoto} resizeMode="cover" />}
                <Pressable style={st.modalCerrar} onPress={() => setDetalle(null)} hitSlop={8}>
                  <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                <View style={{ padding: 20, gap: 10 }}>
                  <Text style={[st.seccion, { marginTop: 0 }]}>{detalle.titulo}</Text>
                  {!!detalle.descripcion && <Text style={{ color: C.gris, lineHeight: 21 }}>{detalle.descripcion}</Text>}
                  <InfoFila icono="calendar-outline" texto={fechaCompleta(detalle.created_at)} />
                  <InfoFila icono="folder-open-outline" texto={`${BUCKET}/${detalle.imagen_path}`} />
                  <InfoFila icono="lock-closed-outline" texto="Archivo privado · se muestra con una URL firmada válida por 1 hora" lineas={2} />
                  <Pressable onPress={() => probarAccesoPublico(detalle.imagen_path)}>
                    <LinearGradient colors={[C.primario, C.primario2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.botonPrin, { marginTop: 6 }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                      <Text style={st.botonPrinTxt}>Probar acceso sin autorización</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Pill({ icono, texto, colorIcono = '#fff' }) {
  return (
    <View style={st.pill}>
      <Ionicons name={icono} size={13} color={colorIcono} />
      <Text style={st.pillTxt}>{texto}</Text>
    </View>
  );
}

function BotonSec({ icono, texto, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.botonSec, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icono} size={18} color={C.primario} />
      <Text style={st.botonSecTxt}>{texto}</Text>
    </Pressable>
  );
}

function InfoFila({ icono, texto, lineas = 1 }) {
  return (
    <View style={[st.fila, { alignItems: 'flex-start', gap: 8 }]}>
      <Ionicons name={icono} size={15} color={C.gris} style={{ marginTop: 1 }} />
      <Text style={st.mono} numberOfLines={lineas}>{texto}</Text>
    </View>
  );
}

const sombra = Platform.select({
  ios: { shadowColor: '#141A33', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(20,26,51,0.08)' },
});

const st = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: C.fondo },
  header: { paddingTop: Platform.OS === 'android' ? 52 : 66, paddingHorizontal: 20, paddingBottom: 60, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  headerDeco: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.12)', top: -80, right: -60 },
  headerLogo: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  headerSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600' },
  headerTitulo: { color: '#fff', fontSize: 27, fontWeight: '800' },
  headerFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  pillTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cuerpo: { paddingHorizontal: 16, gap: 14 },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, ...sombra },
  cardFlotante: { marginTop: -38 },
  avisoError: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: '#FECDCA' },
  etiqueta: { color: C.tinta, fontWeight: '700', fontSize: 13, marginTop: 4 },
  inputFila: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: C.borde, borderRadius: 14, paddingHorizontal: 12 },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: C.tinta, textAlignVertical: 'top' },
  zonaFoto: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#FDBA9F', backgroundColor: C.suave, borderRadius: 18, alignItems: 'center', paddingVertical: 26, gap: 6 },
  zonaIcono: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#FFE4D9', alignItems: 'center', justifyContent: 'center' },
  zonaTitulo: { color: C.tinta, fontWeight: '700', fontSize: 15 },
  gris: { color: C.gris, fontSize: 12.5 },
  preview: { width: '100%', height: 230, borderRadius: 18, backgroundColor: '#eee' },
  previewSombra: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  previewInfo: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewInfoTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  quitar: { position: 'absolute', right: 10, top: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  botonSec: { flex: 1, flexDirection: 'row', gap: 8, backgroundColor: C.suave, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  botonSecTxt: { color: C.primario, fontWeight: '700' },
  botonPrin: { flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  botonPrinTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  resultado: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8, marginTop: 4 },
  mono: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11.5, color: C.gris },
  seccionFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  seccion: { fontSize: 21, fontWeight: '800', color: C.tinta, marginTop: 6 },
  link: { color: C.primario, fontWeight: '700' },
  foto: { width: '100%', height: 190 },
  chipPrivado: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(20,26,51,0.75)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  chipPrivadoTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  itemTitulo: { fontSize: 16, fontWeight: '800', color: C.tinta },
  modalFondo: { flex: 1, backgroundColor: 'rgba(20,26,51,0.55)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', paddingBottom: 28 },
  modalFoto: { width: '100%', height: 300 },
  modalCerrar: { position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
