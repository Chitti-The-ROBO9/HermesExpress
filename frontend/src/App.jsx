import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { BedDouble, Fuel, Mic, Plane, Search } from "lucide-react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const defaultLat = Number(import.meta.env.VITE_DEFAULT_LAT ?? 19.076);
const defaultLng = Number(import.meta.env.VITE_DEFAULT_LNG ?? 72.8777);
const defaultZoom = Number(import.meta.env.VITE_DEFAULT_ZOOM ?? 13);
const mileageKmpl = Number(import.meta.env.VITE_VEHICLE_MILEAGE_KMPL ?? 40);
const initialFuelLiters = Number(import.meta.env.VITE_INITIAL_FUEL_LITERS ?? 2);
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const mapboxStyle = import.meta.env.VITE_MAPBOX_STYLE ?? "mapbox/dark-v11";
const foursquareApiKey = import.meta.env.VITE_FOURSQUARE_API_KEY ?? "";

function getRangeMeters(fuelLiters) {
  return fuelLiters * mileageKmpl * 1000;
}

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const earthRadiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function formatInr(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function extractPlaceCoords(place) {
  const latCandidates = [
    place?.geocodes?.main?.latitude,
    place?.geocodes?.roof?.latitude,
    place?.latitude,
    place?.lat,
    place?.location?.latitude,
    place?.location?.lat
  ];
  const lngCandidates = [
    place?.geocodes?.main?.longitude,
    place?.geocodes?.roof?.longitude,
    place?.longitude,
    place?.lng,
    place?.location?.longitude,
    place?.location?.lng
  ];
  const lat = latCandidates.find((value) => typeof value === "number");
  const lng = lngCandidates.find((value) => typeof value === "number");
  return { lat, lng };
}

function normalizePlaces(rawPlaces = []) {
  return rawPlaces
    .map((place, index) => {
      const { lat, lng } = extractPlaceCoords(place);
      return {
        ...place,
        id: place?.fsq_id ?? place?.id ?? `place-${index}-${place?.name ?? "unknown"}`,
        lat,
        lng
      };
    })
    .filter((place) => typeof place.lat === "number" && typeof place.lng === "number");
}

function buildLocalizedFallback(queryText, rawData, limit, origin) {
  const shiftLat = origin[0] - defaultLat;
  const shiftLng = origin[1] - defaultLng;

  const translated = rawData.slice(0, limit).map((item, index) => {
    const baseLat = item?.geocodes?.main?.latitude ?? defaultLat;
    const baseLng = item?.geocodes?.main?.longitude ?? defaultLng;
    const hasSpecificName = /cafe|coffee|park|garden|fuel|petrol|pump|atm/i.test(item.name ?? "");
    const dynamicName = queryText ? `${queryText} Spot ${index + 1}` : item.name;
    return {
      ...item,
      fsq_id: item.fsq_id ?? `local-${index}`,
      name: hasSpecificName ? item.name : dynamicName,
      geocodes: {
        ...(item.geocodes ?? {}),
        main: {
          latitude: baseLat + shiftLat,
          longitude: baseLng + shiftLng
        }
      }
    };
  });

  return normalizePlaces(translated);
}

function getSpeechRecognition() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function parseVoiceDayPlan(transcript, mileage) {
  const hoursMatch = transcript.match(/(\d+(?:\.\d+)?)\s*hours?/i);
  const fuelMatch = transcript.match(/(\d+(?:\.\d+)?)\s*lit(?:er|re)?s?/i);
  const budgetMatch =
    transcript.match(/(?:₹|rs\.?|inr)\s*(\d[\d,]*)/i) || transcript.match(/budget[^0-9]*(\d[\d,]*)/i);
  const radiusMatch = transcript.match(/within\s*(\d+(?:\.\d+)?)\s*km/i);

  const hours = hoursMatch ? Number(hoursMatch[1]) : null;
  const fuelLiters = fuelMatch ? Number(fuelMatch[1]) : null;
  const budget = budgetMatch ? Number(budgetMatch[1].replaceAll(",", "")) : null;
  const targetRadiusKm = radiusMatch ? Number(radiusMatch[1]) : 5;
  const scooterRangeKm = fuelLiters ? fuelLiters * mileage : null;
  const scooterCostForTarget = (targetRadiusKm / 40) * 105;
  const rapidoEstimate = 25 + targetRadiusKm * 12;
  const busEstimate = 12 + targetRadiusKm * 3.2;
  const cheapestWithoutScooter = busEstimate < rapidoEstimate ? "Bus" : "Rapido";

  return {
    hours,
    fuelLiters,
    budget,
    targetRadiusKm,
    scooterRangeKm,
    scooterCostForTarget,
    rapidoEstimate,
    busEstimate,
    cheapestWithoutScooter,
    recommendation:
      scooterRangeKm && scooterRangeKm >= targetRadiusKm
        ? "Scooter is feasible for your requested local plan."
        : `${cheapestWithoutScooter} is recommended if scooter is not preferred.`
  };
}

function MapRecenter({ center }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);

  return null;
}

const reachableIcon = L.divIcon({
  className: "",
  html: '<div class="cx-marker" />',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const outOfRangeIcon = L.divIcon({
  className: "",
  html: '<div class="hex-marker" />',
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

const fuelIcon = L.divIcon({
  className: "",
  html: '<div class="fuel-marker" />',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const gpsIcon = L.divIcon({
  className: "",
  html: '<div class="gps-marker" />',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const fallbackPlaces = [
  { fsq_id: "fb-1", name: "Brew Byte Cafe", geocodes: { main: { latitude: defaultLat + 0.012, longitude: defaultLng + 0.009 } }, location: { formatted_address: "Madhapur" } },
  { fsq_id: "fb-2", name: "Skyline ATM Hub", geocodes: { main: { latitude: defaultLat + 0.028, longitude: defaultLng - 0.016 } }, location: { formatted_address: "Kondapur" } },
  { fsq_id: "fb-3", name: "Night Owl Coffee", geocodes: { main: { latitude: defaultLat - 0.021, longitude: defaultLng + 0.022 } }, location: { formatted_address: "Jubilee Hills" } }
];

const fallbackParks = [
  { fsq_id: "park-1", name: "Botanical Serenity Park", geocodes: { main: { latitude: defaultLat + 0.018, longitude: defaultLng + 0.013 } }, location: { formatted_address: "Near Hitech City" } },
  { fsq_id: "park-2", name: "Neon Lakeside Garden", geocodes: { main: { latitude: defaultLat + 0.03, longitude: defaultLng + 0.005 } }, location: { formatted_address: "Madhapur Lake Road" } },
  { fsq_id: "park-3", name: "Greenline Urban Park", geocodes: { main: { latitude: defaultLat + 0.022, longitude: defaultLng - 0.01 } }, location: { formatted_address: "Gachibowli stretch" } }
];

const fallbackPumps = [
  { fsq_id: "pump-1", name: "HP Petrol Pump", geocodes: { main: { latitude: defaultLat + 0.01, longitude: defaultLng - 0.006 } } },
  { fsq_id: "pump-2", name: "Indian Oil Station", geocodes: { main: { latitude: defaultLat - 0.009, longitude: defaultLng + 0.012 } } },
  { fsq_id: "pump-3", name: "Bharat Petroleum", geocodes: { main: { latitude: defaultLat + 0.015, longitude: defaultLng + 0.014 } } }
];

export default function App() {
  const [fuelLiters, setFuelLiters] = useState(initialFuelLiters);
  const [query, setQuery] = useState("Cafe");
  const [places, setPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [activeTab, setActiveTab] = useState("flights");
  const [waypoint, setWaypoint] = useState(null);
  const [showFuelAssist, setShowFuelAssist] = useState(true);
  const [fuelStations, setFuelStations] = useState([]);
  const [center, setCenter] = useState([defaultLat, defaultLng]);
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Locating...");
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [dayPlan, setDayPlan] = useState(null);
  const [voiceJourneyPlan, setVoiceJourneyPlan] = useState(null);
  const [lockedJourneyPlan, setLockedJourneyPlan] = useState(null);
  const [typedPlanPrompt, setTypedPlanPrompt] = useState("");
  const [manualLat, setManualLat] = useState(String(defaultLat));
  const [manualLng, setManualLng] = useState(String(defaultLng));
  const rangeMeters = getRangeMeters(fuelLiters);
  const rangeKm = rangeMeters / 1000;
  const mapboxUrl = `https://api.mapbox.com/styles/v1/${mapboxStyle}/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`;
  const usingMapbox = Boolean(mapboxToken);

  function locateUser() {
    if (!window.isSecureContext) {
      setLocationStatus("GPS blocked: browser requires HTTPS or localhost. Use manual location below.");
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus("Geolocation unsupported. Using default city.");
      return;
    }

    setLocationStatus("Locating...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const gpsPoint = [latitude, longitude];
        setCenter(gpsPoint);
        setUserLocation(gpsPoint);
        setLocationStatus("Live location active");
      },
      () => {
        setLocationStatus("Location denied. Using default city.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  const enhancedPlaces = useMemo(() => {
    return places.map((place) => {
      const distanceKm = haversineKm(center, [place.lat, place.lng]);
      const scooterCost = (distanceKm / 40) * 105;
      const rapidoCost = 25 + distanceKm * 12;
      const inRange = distanceKm <= rangeKm;
      return {
        ...place,
        distanceKm,
        scooterCost,
        rapidoCost,
        inRange,
        lowFuel: !inRange
      };
    });
  }, [places, center, rangeKm]);

  const lowestCost = useMemo(() => {
    if (!enhancedPlaces.length) {
      return null;
    }
    const cheapest = enhancedPlaces.reduce((acc, item) => {
      if (!acc || item.scooterCost < acc.scooterCost) {
        return item;
      }
      return acc;
    }, null);
    return cheapest ? formatInr(cheapest.scooterCost) : null;
  }, [enhancedPlaces]);

  async function fetchFoursquareResults(queryText, fallbackData, limit = 6, origin = center) {
    if (!queryText.trim()) {
      return [];
    }

    if (!foursquareApiKey) {
      return buildLocalizedFallback(queryText, fallbackData, limit, origin);
    }

    try {
      const ll = `${origin[0]},${origin[1]}`;
      const url = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(queryText)}&ll=${ll}&limit=${limit}&sort=DISTANCE`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: foursquareApiKey
        }
      });

      if (!response.ok) {
        throw new Error("Foursquare request failed");
      }

      const payload = await response.json();
      const normalized = normalizePlaces(payload.results ?? []);
      return normalized.length ? normalized : buildLocalizedFallback(queryText, fallbackData, limit, origin);
    } catch (error) {
      return buildLocalizedFallback(queryText, fallbackData, limit, origin);
    }
  }

  async function fetchFoursquare(queryText, setData, fallbackData, limit = 6, origin = center) {
    const results = await fetchFoursquareResults(queryText, fallbackData, limit, origin);
    setData(results);
  }

  async function runDiscoverySearch() {
    setLoadingPlaces(true);
    await fetchFoursquare(query, setPlaces, fallbackPlaces, 8);
    setLoadingPlaces(false);
  }

  async function runDiscoverySearchWithTerm(searchTerm) {
    setLoadingPlaces(true);
    await fetchFoursquare(searchTerm, setPlaces, fallbackPlaces, 8);
    setLoadingPlaces(false);
  }

  async function runVoiceJourneyPlanner(transcript, parsedPlan) {
    const wantsCafe = /cafe|coffee|macchiato/i.test(transcript);
    const wantsPark = /park|garden|lake/i.test(transcript);
    if (!wantsCafe || !wantsPark) {
      return;
    }

    setLoadingPlaces(true);
    const cafes = await fetchFoursquareResults("highly rated cafe", fallbackPlaces, 6);
    if (!cafes.length) {
      setVoiceJourneyPlan(null);
      setLoadingPlaces(false);
      return;
    }

    const bestCafe = cafes.reduce((closest, cafe) => {
      if (!closest) {
        return cafe;
      }
      const currentDistance = haversineKm(center, [cafe.lat, cafe.lng]);
      const closestDistance = haversineKm(center, [closest.lat, closest.lng]);
      return currentDistance < closestDistance ? cafe : closest;
    }, null);

    const parksNearby = await fetchFoursquareResults(
      "beautiful park",
      fallbackParks,
      8,
      [bestCafe.lat, bestCafe.lng]
    );
    const maxParkDistance = parsedPlan?.targetRadiusKm ?? 5;
    const shortlistedParks = parksNearby
      .map((park) => ({
        ...park,
        distanceFromCafeKm: haversineKm([bestCafe.lat, bestCafe.lng], [park.lat, park.lng])
      }))
      .filter((park) => park.distanceFromCafeKm <= maxParkDistance)
      .sort((a, b) => a.distanceFromCafeKm - b.distanceFromCafeKm)
      .slice(0, 3);

    const composedResults = [
      { ...bestCafe, name: `${bestCafe.name} (Cafe Pick)`, planType: "cafe" },
      ...shortlistedParks.map((park) => ({
        ...park,
        name: `${park.name} (Park Match)`,
        location: {
          ...park.location,
          formatted_address: `${park.location?.formatted_address ?? "Nearby park"} | ${park.distanceFromCafeKm.toFixed(2)} km from cafe`
        },
        planType: "park"
      }))
    ];
    setPlaces(composedResults);

    const rapidoForCafe = 25 + haversineKm(center, [bestCafe.lat, bestCafe.lng]) * 12;
    const busForCafe = 12 + haversineKm(center, [bestCafe.lat, bestCafe.lng]) * 3.2;
    setVoiceJourneyPlan({
      cafe: bestCafe.name,
      parks: shortlistedParks.map((park) => park.name),
      parkRadius: maxParkDistance,
      cheapestWithoutScooter: busForCafe < rapidoForCafe ? "Bus" : "Rapido",
      cheapestFare: Math.min(busForCafe, rapidoForCafe),
      cafePlace: bestCafe,
      parkPlaces: shortlistedParks
    });
    setLockedJourneyPlan(null);
    setLoadingPlaces(false);
  }

  useEffect(() => {
    runDiscoverySearch();
    // Initial boot search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    locateUser();
  }, []);

  useEffect(() => {
    const shouldShowFuelStations = showFuelAssist && fuelLiters < 1;
    if (!shouldShowFuelStations) {
      setFuelStations([]);
      return;
    }

    fetchFoursquare("petrol pump", setFuelStations, fallbackPumps, 3);
  }, [fuelLiters, showFuelAssist, center]);

  function executeRide(place, mode) {
    const lat = place.lat;
    const lng = place.lng;
    if (mode === "drive") {
      setWaypoint({ lat, lng, name: place.name });
      return;
    }

    const rapidoIntent = `intent://ride?lat=${lat}&lng=${lng}#Intent;scheme=ptr;package=com.rapido.passenger;end`;
    window.location.href = rapidoIntent;
  }

  function startVoicePlanner() {
    if (!window.isSecureContext) {
      setLocationStatus("Mic blocked: browser requires HTTPS or localhost. Use typed planner input.");
      return;
    }

    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) {
      setLocationStatus("Voice API unavailable in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;
    setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
      setVoiceTranscript(transcript);
      const parsed = parseVoiceDayPlan(transcript, mileageKmpl);
      setDayPlan(parsed);

      if (parsed.fuelLiters) {
        setFuelLiters(Math.min(10, Math.max(0.2, parsed.fuelLiters)));
      }
      if (/cafe|coffee|macchiato/i.test(transcript)) {
        setQuery("Cafe");
        runDiscoverySearchWithTerm("Cafe");
      } else if (/park/i.test(transcript)) {
        setQuery("Park");
        runDiscoverySearchWithTerm("Park");
      }
      runVoiceJourneyPlanner(transcript, parsed);
    };
    recognition.onerror = () => {
      setLocationStatus("Voice capture failed. Try again.");
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.start();
  }

  function handlePlanFromText(rawPrompt) {
    const transcript = rawPrompt.trim();
    if (!transcript) {
      return;
    }
    setVoiceTranscript(transcript);
    const parsed = parseVoiceDayPlan(transcript, mileageKmpl);
    setDayPlan(parsed);
    if (parsed.fuelLiters) {
      setFuelLiters(Math.min(10, Math.max(0.2, parsed.fuelLiters)));
    }
    if (/cafe|coffee|macchiato/i.test(transcript)) {
      setQuery("Cafe");
      runDiscoverySearchWithTerm("Cafe");
    } else if (/park/i.test(transcript)) {
      setQuery("Park");
      runDiscoverySearchWithTerm("Park");
    }
    runVoiceJourneyPlanner(transcript, parsed);
  }

  function applyManualLocation() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocationStatus("Invalid manual coordinates.");
      return;
    }
    const manualPoint = [lat, lng];
    setCenter(manualPoint);
    setUserLocation(manualPoint);
    setLocationStatus("Manual location applied.");
  }

  async function copyCurrentCoords() {
    const activePoint = userLocation ?? center;
    const coordsText = `${activePoint[0].toFixed(6)}, ${activePoint[1].toFixed(6)}`;
    setManualLat(String(activePoint[0]));
    setManualLng(String(activePoint[1]));

    if (!navigator.clipboard) {
      setLocationStatus(`Coords loaded in fields: ${coordsText}`);
      return;
    }

    try {
      await navigator.clipboard.writeText(coordsText);
      setLocationStatus(`Copied coords: ${coordsText}`);
    } catch {
      setLocationStatus(`Coords loaded in fields: ${coordsText}`);
    }
  }

  function lockVoiceJourneyPlan() {
    if (!voiceJourneyPlan?.cafePlace || !voiceJourneyPlan?.parkPlaces?.length) {
      setLocationStatus("Need at least one cafe and one park to lock route.");
      return;
    }
    const selectedPark = voiceJourneyPlan.parkPlaces[0];
    setLockedJourneyPlan({
      cafe: voiceJourneyPlan.cafePlace,
      park: selectedPark
    });
    setWaypoint({ lat: voiceJourneyPlan.cafePlace.lat, lng: voiceJourneyPlan.cafePlace.lng, name: `${voiceJourneyPlan.cafePlace.name} (Locked Cafe)` });
    setLocationStatus("Journey locked: Cafe -> Park route pinned.");
  }

  function executeLockedLeg(destination, mode = "drive") {
    if (!destination) {
      return;
    }
    executeRide(
      {
        ...destination,
        lat: destination.lat,
        lng: destination.lng,
        name: destination.name
      },
      mode
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/90 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-cyan-400 md:text-xl">
            HermesExpress | Hyper-Local Mobility Orchestrator
          </h1>
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-300">
              RangeValue: <span className="font-semibold text-cyan-400">{rangeKm.toFixed(1)} km</span>
            </p>
            <button
              type="button"
              onClick={locateUser}
              className="rounded-md border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/25"
            >
              Use My Location
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-400">{locationStatus}</p>
      </header>

      <section className="grid h-[calc(100vh-57px)] grid-cols-1 gap-3 p-3 lg:grid-cols-[320px_1fr_320px]">
        <aside className="flex min-h-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-[inset_2px_2px_8px_rgba(255,255,255,0.03),inset_-2px_-2px_8px_rgba(0,0,0,0.45)]">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-semibold text-slate-100">Discovery & Travel</h2>
            <p className="text-xs text-slate-400">Smart Discovery + premium booking previews</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-cyan-400">Smart Discovery</p>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Cafe, ATM, EV Charger..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring-1"
              />
              <button
                type="button"
                onClick={runDiscoverySearch}
                className="rounded-lg bg-cyan-500 px-3 py-2 text-slate-950 transition hover:bg-cyan-400"
              >
                <Search size={16} />
              </button>
              <button
                type="button"
                onClick={startVoicePlanner}
                className={`rounded-lg px-3 py-2 transition ${isListening ? "bg-rose-500 text-slate-50" : "bg-slate-800 text-cyan-300 hover:bg-slate-700"}`}
                title="Voice day planner"
              >
                <Mic size={16} />
              </button>
            </div>
            {voiceTranscript && (
              <p className="mt-2 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-300">
                Heard: "{voiceTranscript}"
              </p>
            )}
            {dayPlan && (
              <div className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2 text-[11px] text-slate-200">
                <p className="font-semibold text-cyan-300">Voice Day Plan</p>
                <p>Time window: {dayPlan.hours ? `${dayPlan.hours} hours` : "Not specified"}</p>
                <p>Budget: {dayPlan.budget ? formatInr(dayPlan.budget) : "Not specified"}</p>
                <p>Fuel: {dayPlan.fuelLiters ? `${dayPlan.fuelLiters} L` : "Not specified"}</p>
                <p>Scooter range: {dayPlan.scooterRangeKm ? `${dayPlan.scooterRangeKm.toFixed(1)} km` : "Unknown"}</p>
                <p>Local trip ({dayPlan.targetRadiusKm} km) scooter cost: {formatInr(dayPlan.scooterCostForTarget)}</p>
                <p>
                  Cheapest no-scooter mode: {dayPlan.cheapestWithoutScooter} ({formatInr(Math.min(dayPlan.rapidoEstimate, dayPlan.busEstimate))})
                </p>
                <p className="mt-1 text-cyan-200">{dayPlan.recommendation}</p>
              </div>
            )}
            {voiceJourneyPlan && (
              <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2 text-[11px] text-slate-200">
                <p className="font-semibold text-violet-300">Cafe + Park Journey Plan</p>
                <p>Cafe pick: {voiceJourneyPlan.cafe}</p>
                <p>Park radius filter: {voiceJourneyPlan.parkRadius} km</p>
                <p>Park matches: {voiceJourneyPlan.parks.length ? voiceJourneyPlan.parks.join(", ") : "No park found in radius"}</p>
                <p>
                  Cheapest no-scooter route: {voiceJourneyPlan.cheapestWithoutScooter} ({formatInr(voiceJourneyPlan.cheapestFare)})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={lockVoiceJourneyPlan}
                    className="rounded bg-violet-500 px-2 py-1 text-[11px] font-semibold text-slate-50"
                  >
                    Lock Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => executeLockedLeg(voiceJourneyPlan.cafePlace, "drive")}
                    className="rounded bg-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100"
                  >
                    Execute Leg 1
                  </button>
                  <button
                    type="button"
                    onClick={() => executeLockedLeg(voiceJourneyPlan.parkPlaces?.[0], "rapido")}
                    className="rounded bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-slate-950"
                  >
                    Execute Leg 2
                  </button>
                </div>
              </div>
            )}
            <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-[11px]">
              <p className="font-semibold text-slate-200">Typed Day Planner Fallback</p>
              <p className="mt-0.5 text-slate-400">Use this when mic access is blocked by site security.</p>
              <textarea
                value={typedPlanPrompt}
                onChange={(event) => setTypedPlanPrompt(event.target.value)}
                placeholder='Example: "I have 4 hours, 5 liters petrol, budget 500. Find cafe + park within 5km."'
                className="mt-2 h-16 w-full resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <button
                type="button"
                onClick={() => handlePlanFromText(typedPlanPrompt)}
                className="mt-2 rounded bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-slate-950"
              >
                Run Typed Plan
              </button>
            </div>
            <div className="mt-3 max-h-60 space-y-2 overflow-auto pr-1">
              {loadingPlaces && <p className="text-xs text-slate-400">Fetching places...</p>}
              {!loadingPlaces &&
                enhancedPlaces.map((place) => (
                  <article key={place.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-100">{place.name}</p>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${place.inRange ? "bg-cyan-500/20 text-cyan-300" : "bg-rose-500/20 text-rose-300"}`}>
                        {place.inRange ? "IN RANGE" : "LOW FUEL"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{place.location?.formatted_address ?? "Nearby result"}</p>
                    <p className="mt-1 text-xs text-slate-300">
                      {place.distanceKm.toFixed(2)} km | Drive {formatInr(place.scooterCost)} | Rapido {formatInr(place.rapidoCost)}
                    </p>
                  </article>
                ))}
              {!loadingPlaces && enhancedPlaces.length === 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                  No mappable results for this query. Try another keyword.
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab("flights")}
                className={`flex items-center gap-1 rounded px-2 py-1 ${activeTab === "flights" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"}`}
              >
                <Plane size={14} /> Flights
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("hotels")}
                className={`flex items-center gap-1 rounded px-2 py-1 ${activeTab === "hotels" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400"}`}
              >
                <BedDouble size={14} /> Hotels
              </button>
            </div>

            {activeTab === "flights" ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-sm text-slate-100">HYD to GOA</p>
                  <p className="text-xs text-slate-400">Non-stop | Evening</p>
                  <p className="mt-1 text-sm font-semibold text-cyan-300">₹4,500</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                  <p className="text-sm text-slate-100">HYD to DEL</p>
                  <p className="text-xs text-slate-400">1 Stop | Morning</p>
                  <p className="mt-1 text-sm font-semibold text-cyan-300">₹3,200</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                <p className="text-sm text-slate-100">The Grand Hitech</p>
                <p className="text-xs text-slate-400">4.5★ | Hi-Tech City</p>
                <p className="mt-1 text-sm font-semibold text-cyan-300">₹2,500/night</p>
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden rounded-2xl border border-slate-800">
          <MapContainer center={center} zoom={defaultZoom} className="h-full w-full">
            <MapRecenter center={center} />
            <TileLayer
              attribution='&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url={usingMapbox ? mapboxUrl : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"}
            />

            <Circle
              center={center}
              radius={rangeMeters}
              pathOptions={{
                className: "range-pulse",
                color: "#22d3ee",
                fillColor: "#22d3ee",
                fillOpacity: 0.2,
                weight: 2
              }}
            />

            {waypoint && (
              <Polyline positions={[center, [waypoint.lat, waypoint.lng]]} pathOptions={{ color: "#06b6d4", dashArray: "8 10" }} />
            )}

            {lockedJourneyPlan && (
              <>
                <Polyline
                  positions={[center, [lockedJourneyPlan.cafe.lat, lockedJourneyPlan.cafe.lng]]}
                  pathOptions={{ color: "#a78bfa", weight: 3, dashArray: "6 8" }}
                />
                <Polyline
                  positions={[
                    [lockedJourneyPlan.cafe.lat, lockedJourneyPlan.cafe.lng],
                    [lockedJourneyPlan.park.lat, lockedJourneyPlan.park.lng]
                  ]}
                  pathOptions={{ color: "#22d3ee", weight: 3, dashArray: "4 6" }}
                />
              </>
            )}

            {enhancedPlaces.map((place) => {
              return (
                <Marker key={place.id} position={[place.lat, place.lng]} icon={place.inRange ? reachableIcon : outOfRangeIcon}>
                  <Popup minWidth={310}>
                    <div className="space-y-2 text-xs">
                      <p className="text-sm font-semibold text-slate-100">{place.name}</p>
                      <p className="text-slate-400">{place.distanceKm.toFixed(2)} km from base</p>

                      {!place.inRange && (
                        <p className="rounded bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300">
                          CRITICAL: LOW FUEL
                        </p>
                      )}

                      <table className="w-full border-collapse text-left">
                        <tbody>
                          <tr className="border-t border-slate-700">
                            <td className="py-1 pr-2 text-slate-300">Drive Own Activa</td>
                            <td className="py-1 pr-2 text-slate-200">{formatInr(place.scooterCost)}</td>
                            <td className={`py-1 font-medium ${place.inRange ? "text-cyan-300" : "text-rose-300"}`}>
                              {place.inRange ? "In Range" : "Out of Range"}
                            </td>
                          </tr>
                          <tr className="border-t border-slate-700">
                            <td className="py-1 pr-2 text-slate-300">Book Rapido</td>
                            <td className="py-1 pr-2 text-slate-200">{formatInr(place.rapidoCost)}</td>
                            <td className="py-1 font-medium text-cyan-300">Always Available</td>
                          </tr>
                        </tbody>
                      </table>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => executeRide(place, "drive")}
                          className="rounded bg-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100"
                        >
                          Drive
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRide(place, "rapido")}
                          className="rounded bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-slate-950"
                        >
                          Rapido
                        </button>
                        <button
                          type="button"
                          onClick={() => executeRide(place, place.inRange ? "drive" : "rapido")}
                          className={`ml-auto rounded px-3 py-1.5 text-[11px] font-semibold ${place.inRange ? "bg-cyan-500 text-slate-950" : "bg-rose-500 text-slate-50"}`}
                        >
                          EXECUTE RIDE
                        </button>
                      </div>
                      {!place.inRange && <p className="text-[11px] text-rose-300">Recommended: Rapido (outside fuel range)</p>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {fuelStations.map((station) => {
              return (
                <Marker key={station.id} position={[station.lat, station.lng]} icon={fuelIcon}>
                  <Popup>
                    <p className="text-sm font-medium">{station.name}</p>
                    <p className="text-xs text-slate-400">Fuel assist waypoint</p>
                  </Popup>
                </Marker>
              );
            })}

            {userLocation && (
              <Marker position={userLocation} icon={gpsIcon}>
                <Popup>
                  <p className="text-sm font-medium">You are here</p>
                  <p className="text-xs text-slate-400">
                    {userLocation[0].toFixed(5)}, {userLocation[1].toFixed(5)}
                  </p>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-[inset_2px_2px_8px_rgba(255,255,255,0.03),inset_-2px_-2px_8px_rgba(0,0,0,0.45)]">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Vehicle & Logic</h2>
            <p className="text-xs text-slate-400">Activa 5G profile + real-time decisioning</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-400">
              <Fuel size={15} /> Fuel Slider
            </div>
            <div className="mt-4 flex items-center justify-center">
              <input
                id="fuel-slider"
                type="range"
                min="0.2"
                max="10"
                step="0.1"
                value={fuelLiters}
                onChange={(event) => setFuelLiters(Number(event.target.value))}
                className="h-44 w-1.5 cursor-pointer appearance-none rounded-lg bg-slate-700 accent-cyan-400"
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
            </div>
            <p className="mt-2 text-center text-sm text-slate-200">{fuelLiters.toFixed(1)} L</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <p className="font-medium text-slate-100">Vehicle Profile</p>
            <p className="mt-2 text-slate-400">Model: Activa 5G</p>
            <p className="text-slate-400">Mileage: {mileageKmpl} km/L</p>
            <p className="text-slate-400">Current Range: {rangeKm.toFixed(1)} km</p>
            {waypoint && <p className="mt-2 rounded bg-cyan-500/10 px-2 py-1 text-cyan-300">Waypoint: {waypoint.name}</p>}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <p className="font-medium text-slate-100">Manual Location Fallback</p>
            <p className="mt-1 text-xs text-slate-400">Use when GPS access is blocked.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={manualLat}
                onChange={(event) => setManualLat(event.target.value)}
                placeholder="Latitude"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <input
                type="text"
                value={manualLng}
                onChange={(event) => setManualLng(event.target.value)}
                placeholder="Longitude"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>
            <button
              type="button"
              onClick={applyManualLocation}
              className="mt-2 rounded bg-cyan-500 px-2 py-1 text-xs font-semibold text-slate-950"
            >
              Apply Manual Location
            </button>
            <button
              type="button"
              onClick={copyCurrentCoords}
              className="ml-2 mt-2 rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-100"
            >
              Copy My Current Coords
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <p className="font-medium text-slate-100">Live Cost Comparison</p>
            <p className="mt-2 text-slate-400">Results analyzed: {enhancedPlaces.length}</p>
            <p className="text-slate-400">Lowest drive cost: {lowestCost ?? "—"}</p>
            <p className="text-slate-400">Low fuel alerts: {enhancedPlaces.filter((p) => !p.inRange).length}</p>
          </div>

          <label className="mt-auto flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <span className="text-slate-200">Fuel Station Assist (auto &lt; 1L)</span>
            <input
              type="checkbox"
              checked={showFuelAssist}
              onChange={(event) => setShowFuelAssist(event.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
          </label>

          {!usingMapbox && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
              Mapbox unavailable; using CartoDB dark fallback tiles.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
