/**
 * InlineMap Component
 * Mini map embedded in chat messages
 */
import { useState, useMemo } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl';
import { MapSite } from '../types';
import { useTheme } from '../context/ThemeContext';

interface InlineMapProps {
  sites: MapSite[];
  height?: number;
  interactive?: boolean;
  onExpandClick?: () => void;
}

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

export default function InlineMap({ 
  sites, 
  height = 300, 
  interactive = true,
  onExpandClick 
}: InlineMapProps) {
  const { theme } = useTheme();
  
  // Calculate center from sites
  const center = useMemo(() => {
    if (sites.length === 0) {
      return { latitude: 37.7749, longitude: -122.4194, zoom: 10 }; // San Francisco default
    }
    
    const avgLat = sites.reduce((sum, site) => sum + site.latitude, 0) / sites.length;
    const avgLng = sites.reduce((sum, site) => sum + site.longitude, 0) / sites.length;
    
    // Calculate appropriate zoom level based on spread
    const latSpread = Math.max(...sites.map(s => s.latitude)) - Math.min(...sites.map(s => s.latitude));
    const lngSpread = Math.max(...sites.map(s => s.longitude)) - Math.min(...sites.map(s => s.longitude));
    const maxSpread = Math.max(latSpread, lngSpread);
    
    let zoom = 12;
    if (maxSpread > 2) zoom = 8;
    else if (maxSpread > 1) zoom = 9;
    else if (maxSpread > 0.5) zoom = 10;
    else if (maxSpread > 0.2) zoom = 11;
    
    return { latitude: avgLat, longitude: avgLng, zoom };
  }, [sites]);

  const [viewState, setViewState] = useState({
    longitude: center.longitude,
    latitude: center.latitude,
    zoom: center.zoom
  });

  const mapStyle = theme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11';

  const getStatusColor = (status: MapSite['status']) => {
    switch (status) {
      case 'NORMAL': return '#22c55e';
      case 'WARNING': return '#f59e0b';
      case 'CRITICAL': return '#ef4444';
      case 'OUTAGE': return '#dc2626';
      default: return '#3B82F6';
    }
  };

  return (
    <div className="relative w-full rounded-xl border border-gray-200/30 dark:border-white/10 bg-white/50 dark:bg-[#2d2d32]/50 backdrop-blur-sm overflow-hidden">
      <Map
        {...viewState}
        onMove={evt => interactive && setViewState(evt.viewState)}
        style={{ width: '100%', height: `${height}px` }}
        mapStyle={mapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        interactive={interactive}
        dragPan={interactive}
        scrollZoom={interactive}
        doubleClickZoom={interactive}
      >
        <NavigationControl position="top-right" />
        
        {sites.map((site) => (
          <Marker
            key={site.siteId}
            longitude={site.longitude}
            latitude={site.latitude}
            anchor="center"
          >
            <div
              className="relative cursor-pointer"
              title={`${site.siteName} (${site.status})`}
            >
              {/* Site marker */}
              <div
                className="w-3 h-3 rounded-full border-2 border-white shadow-lg transition-transform hover:scale-150"
                style={{
                  backgroundColor: getStatusColor(site.status)
                }}
              />
              
              {/* Anomaly indicator */}
              {site.anomalyCount > 0 && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white" />
              )}
            </div>
          </Marker>
        ))}
      </Map>
      
      {/* Expand button */}
      {onExpandClick && (
        <button
          onClick={onExpandClick}
          className="absolute bottom-3 left-3 px-3 py-1.5 text-xs font-medium bg-white/90 dark:bg-[#2d2d32]/90 border border-gray-200/50 dark:border-white/20 rounded-lg hover:bg-white dark:hover:bg-[#2d2d32] transition-all shadow-lg backdrop-blur-sm"
        >
          Open Full Map
        </button>
      )}
      
      {/* Site count badge */}
      <div className="absolute top-3 left-3 px-2 py-1 text-xs font-medium bg-white/90 dark:bg-[#2d2d32]/90 border border-gray-200/50 dark:border-white/20 rounded-md shadow-lg backdrop-blur-sm text-text-primary dark:text-white">
        {sites.length} site{sites.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
