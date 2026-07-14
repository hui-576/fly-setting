export interface InitialView {
  source: "device" | "hubei-fallback";
  longitude: number;
  latitude: number;
  altitude: number;
}

export const HUBEI_VIEW: Readonly<InitialView> = Object.freeze({
  source: "hubei-fallback",
  longitude: 112.3,
  latitude: 30.9,
  altitude: 900_000,
});

export function locateInitialView(geolocation?: Geolocation): Promise<InitialView> {
  if (!geolocation) return Promise.resolve(HUBEI_VIEW);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          source: "device",
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          altitude: 12_000,
        }),
      () => resolve(HUBEI_VIEW),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5_000 },
    );
  });
}
