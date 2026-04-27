# Hamburger Menu - Map Controls

## Overview
Implemented a professional, sliding hamburger menu in the top-right corner of the map to consolidate map controls and improve UI/UX.

## Features

### 1. **Hamburger Button**
**Location**: Top-right corner of the map
- **Icons**: 
  - `Menu` icon when closed (☰)
  - `X` icon when open (✕)
- **Style**: Naavik-themed, with hover effects
- **Animation**: Smooth icon transition

### 2. **Sliding Menu Panel**
**Animation**: 300ms slide-in from right
- **Width**: 320px (80 in Tailwind)
- **Design**: Card-style with shadow and rounded corners
- **State Management**: Opens/closes via hamburger button
- **Outside Interaction**: Disabled when closed (pointer-events-none)

### 3. **Menu Contents**

#### A. Display Options Section
**Legend Toggle**:
- **Icon**: Eye (on) / EyeOff (off)
- **Visual Indicator**: ON/OFF badge
- **Color**: Naavik red when active
- **Function**: Shows/hides the legend in bottom-left corner

#### B. Sector Radius Control
**Visibility**: Only appears when:
- Zoom level ≥ 9
- Cell sectors are loaded

**Components**:
- **Header**: Icon + Label + Current Value Badge
- **Slider**: Range input (100m - 2km)
  - Custom styling with Naavik red gradient
  - Smooth thumb animation
- **Quick Presets**: Three buttons
  - 🔻 Min (100m)
  - Default (500m)
  - 🔺 Max (2km)
- **Active State**: Selected preset highlighted in red

## User Experience

### Opening the Menu
1. Click the hamburger icon (☰) in top-right corner
2. Menu slides in from the right
3. Icon changes to X

### Closing the Menu
1. Click the X icon
2. Menu slides out to the right
3. Icon changes back to hamburger

### Legend Control
- **Toggle**: Click the Legend button in menu
- **Effect**: Legend in bottom-left appears/disappears
- **Visual Feedback**: Icon and badge change instantly

### Sector Sizing
- **When Available**: Zoom in to level 9+ to see sectors
- **Slider**: Drag to any value between 100m-2km
- **Presets**: Click for instant jumps to common sizes
- **Real-time Update**: Sectors resize immediately

## Theme Integration

### Colors
- **Primary**: Naavik Red (#ED1C24)
- **Background**: Cream/Pulse surface colors
- **Borders**: Theme-aware border colors
- **Text**: Hierarchical text colors (primary, secondary, muted)

### Dark Mode
- Full support for light/dark themes
- All components adapt to theme changes
- Proper contrast in both modes

## Technical Details

### State Management
```typescript
const [isMenuOpen, setIsMenuOpen] = useState(false);
const [showLegend, setShowLegend] = useState(true);
const [sectorRadiusMeters, setSectorRadiusMeters] = useState(500);
```

### Component Structure
```
Hamburger Button (z-20)
  └─ Sliding Menu Panel (z-10)
      ├─ Menu Header
      ├─ Display Options
      │   └─ Legend Toggle
      └─ Sector Radius Control
          ├─ Slider
          └─ Quick Presets
```

### CSS Classes
- **Transitions**: `transition-all duration-300`
- **Transforms**: `translate-x-0` / `translate-x-[400px]`
- **Opacity**: Fades in/out with slide
- **Pointer Events**: Disabled when hidden

### Icons Used
From Lucide React:
- `Menu` - Hamburger icon (3 lines)
- `X` - Close icon
- `Eye` - Legend visible
- `EyeOff` - Legend hidden
- `Maximize2` - Sector size icon
- `Minimize2` - Min preset icon

## Layout & Positioning

### Before (Old Layout)
```
┌─────────────────────────────────┐
│                                 │
│              [Sector Control]   │  ← Always visible
│                                 │
│                                 │
│  [Legend]                       │
└─────────────────────────────────┘
```

### After (New Layout)
```
┌─────────────────────────────────┐
│                            [☰]  │  ← Hamburger button
│                                 │
│                                 │
│  [Legend]?                      │  ← Toggleable
└─────────────────────────────────┘

Click [☰] reveals sliding menu:
                    ┌──────────────┐
                    │ Map Controls │
                    ├──────────────┤
                    │ 👁 Legend ON │
                    │              │
                    │ Sector Size  │
                    │ ├─────●────┤ │
                    │ [100] [500]  │
                    └──────────────┘
```

## Benefits

### 1. **Clean UI**
- Reduced visual clutter
- More map viewing space
- Professional appearance

### 2. **Organized Controls**
- All map controls in one place
- Logical grouping
- Easy to find and use

### 3. **Scalable Design**
- Easy to add more controls
- Consistent pattern for new features
- Maintains clean layout

### 4. **Mobile-Ready**
- Touch-friendly button size
- Slide-out pattern familiar to mobile users
- Prevents accidental clicks

## Future Enhancements

### Potential Additions to Menu
1. **Filter Options**
   - Show/hide by status (Normal, Warning, Critical, Outage)
   - Filter by technology (4G, 5G)
   - Date range selector

2. **Display Settings**
   - Cluster radius adjustment
   - Label size control
   - Opacity controls

3. **Layer Controls**
   - Toggle sectors on/off
   - Toggle site markers
   - Toggle traffic/satellite layers

4. **Export Options**
   - Screenshot current view
   - Export visible data as CSV
   - Share current map state

5. **Search**
   - Search for site by ID/name
   - Zoom to searched location

## Performance

### Optimizations
- **Conditional Rendering**: Menu content only when open
- **CSS Animations**: Hardware-accelerated transforms
- **No Layout Shifts**: Absolute positioning
- **Smooth Transitions**: 300ms timing

### Impact
- **Negligible**: Menu adds minimal overhead
- **Improved**: Less clutter = better map performance perception
- **Responsive**: Instant open/close feedback

## Browser Compatibility
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers

## Accessibility Considerations

### Current
- Clear visual indicators (icons + text)
- Color contrast meets standards
- Hover states for buttons

### Future Improvements
- Keyboard navigation (Tab, Enter, Esc)
- ARIA labels for screen readers
- Focus management when opening/closing

---

**Status**: ✅ Implemented and Working
**Version**: 1.0.0
**Date**: February 2026
