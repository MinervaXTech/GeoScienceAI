import { useEffect, useRef, useState } from "react";
import type { Polygon } from "geojson";
import { EE_DATASETS, EE_PROJECT_PATTERN, EE_SCENE_LIMIT, EE_SCOPE, earthEngineFrame, earthEngineRequest, normalizeAssetName, pixelExpression, sceneResolution, searchExpression, type EarthEngineScene } from "../geo/earthEngine";
import type { MuseImage } from "../geo/muse";
import { lngLatToImagePixel } from "../geo/sam";

interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string; error_description?: string }
interface GoogleIdentity { accounts: { oauth2: { initTokenClient(options: { client_id: string; scope: string; callback(response: TokenResponse): void; error_callback(error: { type?: string; message?: string }): void }): { requestAccessToken(): void }; revoke(token: string, callback: () => void): void } } }
const identity = () => (window as unknown as { google?: GoogleIdentity }).google?.accounts?.oauth2;
let identityReady: Promise<void> | null = null;
function loadIdentity() {
  if (identity()) return Promise.resolve();
  if (identityReady) return identityReady;
  identityReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true;
    script.onload = () => identity() ? resolve() : reject(Error("Google sign-in could not be initialized."));
    script.onerror = () => { script.remove(); reject(Error("Google sign-in could not load. Check your connection and retry.")); };
    document.head.append(script);
  }).catch((e) => { identityReady = null; throw e; });
  return identityReady;
}
let session: { token: string; expiresAt: number } | null = null; // Memory only, never localStorage or server logs.

export function useEarthEngine(mapId: string, area: Polygon | null) {
  const projectId = import.meta.env.VITE_EARTH_ENGINE_PROJECT_ID ?? "", clientId = import.meta.env.VITE_EARTH_ENGINE_CLIENT_ID ?? "";
  const configured = EE_PROJECT_PATTERN.test(projectId) && /^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId);
  const [ready, setReady] = useState(false), [auth, setAuth] = useState(session && session.expiresAt > Date.now() ? session : null);
  const [phase, setPhase] = useState(""), [error, setError] = useState("");
  const [dataset, setDataset] = useState("skysat"), [assetId, setAssetId] = useState("");
  const [scenes, setScenes] = useState<EarthEngineScene[]>([]), [selected, setSelected] = useState("");
  const [bands, setBands] = useState<[string, string, string]>(["R", "G", "B"]), [minimum, setMinimum] = useState(0), [maximum, setMaximum] = useState(255);
  const [attribution, setAttribution] = useState(EE_DATASETS[0].attribution as string);
  const [searchedKey, setSearchedKey] = useState(""), [previewState, setPreview] = useState<{ key: string; image: MuseImage } | null>(null);
  const pending = useRef<AbortController | null>(null), authVersion = useRef(0), mounted = useRef(true);
  const areaKey = area ? JSON.stringify(area) : "";
  const searchKey = JSON.stringify([mapId, areaKey, dataset, assetId]);
  const currentKey = useRef(searchKey); currentKey.current = searchKey;
  const preset = EE_DATASETS.find((item) => item.id === dataset);
  const scene = scenes.find((item) => item.name === selected);
  const previewKey = JSON.stringify([searchKey, selected, bands, minimum, maximum, attribution]);
  const currentPreview = useRef(previewKey); currentPreview.current = previewKey;
  const preview = previewState?.key === previewKey ? previewState.image : null;
  useEffect(() => {
    mounted.current = true;
    if (configured) void loadIdentity().then(() => { if (mounted.current) setReady(true); }).catch((e) => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; pending.current?.abort(); };
  }, [configured]);
  useEffect(() => {
    if (!auth) return;
    const timer = setTimeout(() => { if (session === auth) session = null; setAuth(null); }, Math.max(0, auth.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [auth]);
  useEffect(() => { pending.current?.abort(); pending.current = null; setPhase(""); setError(""); }, [searchKey]);
  const connect = () => {
    const oauth = identity(); if (!configured || !oauth || pending.current) return;
    const version = ++authVersion.current; setError(""); setPhase("Waiting for Google sign-in…");
    oauth.initTokenClient({ client_id: clientId, scope: EE_SCOPE,
      callback(response) {
        if (!mounted.current || version !== authVersion.current) return;
        setPhase("");
        const expires = Number(response.expires_in);
        if (response.error || !response.access_token || !Number.isFinite(expires) || expires <= 30 || !response.scope?.split(/\s+/).includes(EE_SCOPE)) { setError(response.error_description ?? response.error ?? "Google did not grant the required read-only access."); return; }
        session = { token: response.access_token, expiresAt: Date.now() + (Math.min(expires, 86400) - 30) * 1000 }; setAuth(session);
      }, error_callback(e) { if (mounted.current && version === authVersion.current) { setPhase(""); setError(e.type === "popup_closed" ? "Google sign-in was closed. You can try again." : e.message ?? "Allow the Google sign-in popup and try again."); } },
    }).requestAccessToken();
  };
  const disconnect = () => {
    authVersion.current++; pending.current?.abort(); pending.current = null; setPhase("");
    if (auth) identity()?.revoke(auth.token, () => {});
    session = null; setAuth(null); setPreview(null);
  };
  const chooseDataset = (id: string) => {
    const next = EE_DATASETS.find((item) => item.id === id);
    setDataset(next ? id : "asset"); setScenes([]); setSelected(""); setSearchedKey("");
    if (next) { setBands([...next.bands]); setMaximum(next.max); setMinimum(0); setAttribution(next.attribution); }
    else { setAttribution(""); setBands(["R", "G", "B"]); setMaximum(255); setMinimum(0); }
  };
  const getToken = () => { if (!auth || auth.expiresAt <= Date.now()) throw Error("Sign in to Earth Engine first."); return auth.token; };
  const chooseScene = (name: string, available = scenes) => {
    setSelected(name);
    const ids = available.find((item) => item.name === name)?.bands?.map((b) => b.id) ?? [];
    const desired = preset?.bands ?? ["R", "G", "B"];
    if (desired.every((id) => ids.includes(id))) setBands([...desired] as [string, string, string]);
    else if (ids.length >= 3) setBands([ids[0]!, ids[1]!, ids[2]!]);
  };
  const search = async () => {
    if (pending.current || !area) return;
    const controller = new AbortController(), key = searchKey; pending.current = controller; setError(""); setPhase("Checking imagery coverage for this polygon…"); setPreview(null); setScenes([]); setSelected(""); setSearchedKey("");
    try {
      const token = getToken(); let available: EarthEngineScene[];
      if (!preset) {
        const response = await earthEngineRequest(normalizeAssetName(assetId), token, controller.signal);
        const asset = await response.json() as EarthEngineScene;
        if (asset.type !== "IMAGE") throw Error("This asset is not a single image. Choose a supported collection or enter a specific image asset.");
        available = [asset];
      } else {
        const response = await earthEngineRequest(`projects/${projectId}/imageCollection:computeImages`, token, controller.signal, { expression: searchExpression(preset.collection, area, dataset === "sentinel2"), pageSize: EE_SCENE_LIMIT });
        const result = await response.json();
        if (result.images !== undefined && !Array.isArray(result.images)) throw Error("Earth Engine returned invalid image metadata.");
        available = result.images ?? [];
      }
      if (controller.signal.aborted || currentKey.current !== key) return;
      available = available.filter((item) => typeof item.name === "string" && item.bands?.length);
      setScenes(available); setSearchedKey(key);
      if (available[0]) chooseScene(available[0].name, available);
    } catch (e) { if (!controller.signal.aborted && currentKey.current === key) setError(e instanceof Error ? e.message : "Image coverage could not be checked."); }
    finally { if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); } }
  };
  const capture = async () => {
    if (pending.current || !area || !scene || searchedKey !== searchKey) return;
    const controller = new AbortController(), key = previewKey; pending.current = controller; setError(""); setPhase("Exporting the selected Earth Engine image…"); setPreview(null);
    try {
      const token = getToken(), nativeResolutionM = sceneResolution(scene, bands, preset?.resolution ?? null), frame = earthEngineFrame(area, nativeResolutionM);
      const response = await earthEngineRequest(`projects/${projectId}/image:computePixels`, token, controller.signal, { expression: pixelExpression(scene.name, area, bands, minimum, maximum), fileFormat: "PNG", grid: frame.grid });
      if (!response.headers.get("content-type")?.includes("image/png")) throw Error("Earth Engine did not return a PNG image.");
      const blob = await response.blob(); if (blob.size > 8 * 1024 * 1024) throw Error("Earth Engine preview exceeded the image limit.");
      const bitmap = await createImageBitmap(blob);
      try {
        if (bitmap.width !== frame.width || bitmap.height !== frame.height) throw Error("Earth Engine pixels do not match the requested geographic grid.");
        const canvas = document.createElement("canvas"); canvas.width = frame.width; canvas.height = frame.height;
        const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Image preview is unavailable.");
        // Reapply the same straight-in-Mercator polygon shown in the editor.
        ctx.beginPath(); area.coordinates[0]!.forEach((point, i) => { const [x, y] = lngLatToImagePixel(frame, [point[0]!, point[1]!]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.clip();
        ctx.drawImage(bitmap, 0, 0); const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
        if (!pixels.data.some((value, i) => i % 4 === 3 && value > 0)) throw Error("This image has no valid pixels inside the polygon. Choose another scene.");
        if (controller.signal.aborted || currentPreview.current !== key) return;
        setPreview({ key, image: { width: frame.width, height: frame.height, corners: frame.corners, source: "earth-engine", area, imageDataUrl: canvas.toDataURL("image/png"), earthEngine: {
          projectId, assetId: scene.name, ...(preset ? { collectionId: preset.collection } : {}), bands, displayMin: minimum, displayMax: maximum,
          sourceDate: scene.startTime ?? null, nativeResolutionM, exportResolutionMapM: frame.resolution, attribution: attribution.trim(), previewedAt: new Date().toISOString(),
        } } });
      } finally { bitmap.close(); }
    } catch (e) { if (!controller.signal.aborted && currentPreview.current === key) setError(e instanceof Error ? e.message : "Earth Engine image export failed."); }
    finally { if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); } }
  };
  return { configured, ready, connected: !!auth, projectId, hasArea: !!area, connect, disconnect, phase, error, dataset, chooseDataset, assetId, setAssetId,
    scenes: searchedKey === searchKey ? scenes : [], searched: searchedKey === searchKey, scene: searchedKey === searchKey ? scene : undefined,
    selected, chooseScene, bands, setBands, minimum, setMinimum, maximum, setMaximum, attribution, setAttribution, preview, search, capture,
    retrySignIn: () => { setError(""); void loadIdentity().then(() => { if (mounted.current) setReady(true); }).catch((e) => { if (mounted.current) setError(e.message); }); },
    cancel: () => { authVersion.current++; pending.current?.abort(); pending.current = null; setPhase(""); },
  };
}
export type EarthEngineController = ReturnType<typeof useEarthEngine>;
