import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS


load_dotenv()

# Get the path to the frontend dist directory
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"

app = Flask(__name__, static_folder=str(frontend_dist), static_url_path="")
CORS(app)


def to_float(key: str, fallback: float) -> float:
    raw_value = os.getenv(key)
    if raw_value is None:
        return fallback
    try:
        return float(raw_value)
    except ValueError:
        return fallback


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "hermesexpress-backend"})


@app.get("/api/config")
def config():
    lat = to_float("HERMES_DEFAULT_LAT", 19.0760)
    lng = to_float("HERMES_DEFAULT_LNG", 72.8777)
    zoom = int(to_float("HERMES_DEFAULT_ZOOM", 13))
    mileage_kmpl = to_float("HERMES_VEHICLE_MILEAGE_KMPL", 40.0)
    fuel_liters = to_float("HERMES_FUEL_LITERS", 2.0)
    range_meters = mileage_kmpl * fuel_liters * 1000

    return jsonify(
        {
            "map_center": {"lat": lat, "lng": lng},
            "default_zoom": zoom,
            "vehicle_profile": {
                "mileage_kmpl": mileage_kmpl,
                "fuel_liters": fuel_liters,
                "range_meters": range_meters,
            },
        }
    )


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    if path != "" and Path(frontend_dist / path).is_file():
        return send_from_directory(frontend_dist, path)
    return send_from_directory(frontend_dist, "index.html")


if __name__ == "__main__":
    port = int(os.getenv("HERMES_FLASK_PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
