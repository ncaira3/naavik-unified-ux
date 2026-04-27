/**
 * FluidBackground — subtle fluid animated gradient mesh.
 * Adapts to light/dark theme. Pure CSS transforms → GPU only.
 */
export default function FluidBackground({
  className = '',
  theme,
}: {
  className?: string;
  theme?: 'light' | 'dark';
}) {
  const isDark = theme === 'dark';

  return (
    <div
      className={`fluid-bg ${isDark ? 'fluid-bg--dark' : 'fluid-bg--light'} ${className}`}
      aria-hidden="true"
    >
      <div className="fluid-blob fluid-blob--1" />
      <div className="fluid-blob fluid-blob--2" />
      <div className="fluid-blob fluid-blob--3" />
      <div className="fluid-blob fluid-blob--4" />
      <div className="fluid-blob fluid-blob--5" />
      <div className="fluid-blob fluid-blob--6" />
    </div>
  );
}
