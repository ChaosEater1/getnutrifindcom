import { useCallback, useEffect, useState } from "react";

export type UserLocation = {
  label: string; // human-readable (city/postcode/coords)
  source: "geo" | "manual";
};

const STORAGE_KEY = "nutrifind_location_v1";

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
      { headers: { Accept: "application/json" } }
    );
    const data = await res.json();
    const a = data.address || {};
    return (
      a.city ||
      a.town ||
      a.village ||
      a.suburb ||
      a.county ||
      a.state ||
      `${lat.toFixed(2)}, ${lon.toFixed(2)}`
    );
  } catch {
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }
}

export function useLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLocation(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const persist = (loc: UserLocation | null) => {
    setLocation(loc);
    try {
      if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const requestGeo = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation isn't available on this device.");
      return;
    }
    setRequesting(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const label = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        persist({ label, source: "geo" });
        setRequesting(false);
      },
      (err) => {
        setRequesting(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enter your area manually."
            : "Couldn't get your location. Enter it manually."
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  }, []);

  const setManual = useCallback((label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    persist({ label: trimmed, source: "manual" });
    setError(null);
  }, []);

  const clear = useCallback(() => persist(null), []);

  return { location, requesting, error, requestGeo, setManual, clear };
}
