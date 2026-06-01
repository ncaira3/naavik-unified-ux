/**
 * EventMapOverlay — renders the radius circle + event markers on the Mapbox
 * canvas. Mounted inside <MapGL>.
 *
 * Hover behaviour: the parent gets `onHover(event, screenAnchor | null)` so it
 * can render a popover anchored to the marker's screen position. We use
 * `mapRef.getMap().project(lngLat)` to translate world coordinates to pixels
 * — far more reliable than measuring DOM offsets when the marker hasn't
 * mounted yet.
 */
import { useMemo } from 'react';
import { Marker, Source, Layer, useMap } from 'react-map-gl';
import { CATEGORY_COLOR, type LocalEvent } from '../../services/localEvents';

interface Props {
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  events: LocalEvent[];
  hoveredEventId: string | null;
  selectedEventId: string | null;
  onHover: (event: LocalEvent | null, anchor: { x: number; y: number } | null) => void;
  onMarkerClick: (event: LocalEvent) => void;
}

function radiusPolygon(centerLat: number, centerLng: number, radiusMiles: number) {
  const steps = 64;
  const lat0 = centerLat;
  const lng0 = centerLng;
  const latRadius = radiusMiles / 69;
  const lngRadius = radiusMiles / (69 * Math.cos((lat0 * Math.PI) / 180));
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([lng0 + lngRadius * Math.cos(t), lat0 + latRadius * Math.sin(t)]);
  }
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
        properties: {},
      },
    ],
  };
}

export default function EventMapOverlay({
  centerLat,
  centerLng,
  radiusMiles,
  events,
  hoveredEventId,
  selectedEventId,
  onHover,
  onMarkerClick,
}: Props) {
  const { current: map } = useMap();
  const circleGeo = useMemo(
    () => radiusPolygon(centerLat, centerLng, radiusMiles),
    [centerLat, centerLng, radiusMiles],
  );

  return (
    <>
      <Source id="event-radius" type="geojson" data={circleGeo}>
        <Layer
          id="event-radius-fill"
          type="fill"
          paint={{ 'fill-color': '#6366f1', 'fill-opacity': 0.06 }}
        />
        <Layer
          id="event-radius-outline"
          type="line"
          paint={{
            'line-color': '#6366f1',
            'line-width': 1.4,
            'line-opacity': 0.45,
            'line-dasharray': [3, 3],
          }}
        />
      </Source>

      {events.map((e) => {
        const color = CATEGORY_COLOR[e.category] ?? '#6b7280';
        const isActive = e.id === hoveredEventId || e.id === selectedEventId;
        const size = isActive ? 24 : 18;
        return (
          <Marker
            key={e.id}
            longitude={e.lng}
            latitude={e.lat}
            anchor="bottom"
            onClick={(ev) => {
              ev.originalEvent.stopPropagation();
              onMarkerClick(e);
            }}
          >
            <div
              className="cursor-pointer transition-transform duration-150"
              style={{
                width: size,
                height: (size * 32) / 24,
                filter: isActive
                  ? `drop-shadow(0 6px 12px ${color}80) drop-shadow(0 2px 4px ${color}60)`
                  : `drop-shadow(0 2px 4px ${color}40)`,
                transform: isActive ? 'translateY(-2px)' : 'none',
              }}
              onMouseEnter={() => {
                // Translate world coords to screen pixels via Mapbox's projector,
                // so the popover sits exactly on the marker tip.
                const m = (map as any)?.getMap?.();
                if (!m) return onHover(e, null);
                const pt = m.project([e.lng, e.lat]);
                onHover(e, { x: pt.x, y: pt.y });
              }}
              onMouseLeave={() => onHover(null, null)}
            >
              <svg viewBox="0 0 24 32" width={size} height={(size * 32) / 24}>
                <path
                  d="M12 0c6.6 0 12 5.4 12 12 0 8.6-12 20-12 20S0 20.6 0 12C0 5.4 5.4 0 12 0z"
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <circle cx="12" cy="12" r="4.5" fill="#ffffff" />
              </svg>
            </div>
          </Marker>
        );
      })}
    </>
  );
}
