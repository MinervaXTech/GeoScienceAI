// HACKATHON-NEW (2026-10-30): local metric projection for the UPM area.
// The peak layer stores WGS84 and EPSG:3857 coordinates. Web Mercator distances
// are inflated by 1/cos(latitude), so all route geometry uses UTM zone 47N
// (EPSG:32647), whose zone (96-102 E) contains UPM at about 101.72 E, 2.98 N.
// Points go WGS84 -> EPSG:32647 with proj4 2.22.0 (MIT licence, npm dependency).
import proj4 from "proj4";

export const LOCAL_CRS = "EPSG:32647";
export const LOCAL_PROJ = "+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs";
const toUtm = proj4("EPSG:4326", LOCAL_PROJ);

export const project = ([lon, lat]) => {
  const [x, y] = toUtm.forward([lon, lat]);
  return { x, y };
};
