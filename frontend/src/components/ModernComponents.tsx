/**
 * Modern Component Library
 * Modernized, production-ready components using the new design system
 *
 * Usage: Copy these component patterns throughout the codebase as reference
 * for consistent, modern styling with proper states and accessibility
 */

import React from 'react';

// ============================================
// BUTTON COMPONENTS
// ============================================

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

/**
 * Primary Button - Modern, accessible button component
 *
 * Usage:
 * <Button variant="primary">Save Changes</Button>
 * <Button variant="secondary" size="lg">Continue</Button>
 * <Button variant="danger" disabled>Delete</Button>
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    variant = 'primary',
    size = 'md',
    isLoading,
    disabled,
    className = '',
    children,
    ...props
  }, ref) => {
    const baseStyles = `
      font-medium rounded-lg transition-all duration-150
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500
      disabled:opacity-50 disabled:cursor-not-allowed
      active:scale-95
    `;

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-caption-sm',
      md: 'px-4 py-2.5 text-body-sm',
      lg: 'px-6 py-3 text-body-md',
    };

    const variantStyles = {
      primary: `
        bg-ui-btn text-ui-btn-fg
        hover:bg-ui-btn-hover active:bg-ui-btn-hover
        shadow-sm hover:shadow-md
      `,
      secondary: `
        bg-slate-700 text-text-primary border border-slate-600
        hover:bg-slate-600 active:bg-slate-800
      `,
      ghost: `
        bg-transparent text-sky-500 border border-sky-500
        hover:bg-sky-500/10 active:bg-sky-500/20
      `,
      danger: `
        bg-red-600 text-white
        hover:bg-red-700 active:bg-red-800
        shadow-sm hover:shadow-md
      `,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin">⏳</span>
            {children}
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

// ============================================
// CARD COMPONENTS
// ============================================

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'filled';
}

interface CardComponent extends React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof CardHeader;
  Body: typeof CardBody;
}

/**
 * Modern Card Component
 *
 * Usage:
 * <Card>
 *   <Card.Header>Title</Card.Header>
 *   <Card.Body>Content</Card.Body>
 * </Card>
 */
const CardBase = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', className = '', children, ...props }, ref) => {
    const variantStyles = {
      default: `
        bg-slate-800 border border-slate-700
        shadow-sm hover:shadow-base transition-shadow duration-200
      `,
      elevated: `
        bg-slate-800 border border-slate-700
        shadow-md hover:shadow-lg transition-shadow duration-200
      `,
      filled: `
        bg-slate-700 border border-slate-600
        shadow-none
      `,
    };

    return (
      <div
        ref={ref}
        className={`rounded-lg p-6 ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardBase.displayName = 'Card';

interface CardSectionProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CardHeader = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`border-b border-slate-700 pb-4 mb-4 ${className}`}
      {...props}
    >
      <h3 className="text-heading-sm text-text-primary">{children}</h3>
    </div>
  )
);
CardHeader.displayName = 'CardHeader';

export const CardBody = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`text-body-md text-text-secondary ${className}`}
      {...props}
    >
      {children}
    </div>
  )
);
CardBody.displayName = 'CardBody';

export const Card = Object.assign(CardBase, {
  Header: CardHeader,
  Body: CardBody,
}) as CardComponent;

// ============================================
// INPUT & FORM COMPONENTS
// ============================================

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Modern Input Component with label and error state
 *
 * Usage:
 * <Input label="Email" placeholder="user@example.com" />
 * <Input error="Email is required" />
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => (
    <div className="space-y-2">
      {label && (
        <label className="text-caption-lg font-medium text-text-primary">
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        ref={ref}
        className={`
          w-full px-4 py-3 rounded-lg
          bg-slate-700 border border-slate-600
          text-text-primary placeholder-text-muted
          text-body-md
          focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400
          transition-all duration-150
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-caption-sm text-red-400">{error}</p>}
      {helperText && <p className="text-caption-sm text-text-muted">{helperText}</p>}
    </div>
  )
);

Input.displayName = 'Input';

// ============================================
// MODAL COMPONENTS
// ============================================

interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

interface ModalComponent extends React.ForwardRefExoticComponent<ModalProps & React.RefAttributes<HTMLDivElement>> {
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
}

/**
 * Modern Modal Component
 *
 * Usage:
 * <Modal isOpen={isOpen} onClose={closeModal} title="Confirm Action">
 *   <Modal.Body>Are you sure?</Modal.Body>
 *   <Modal.Footer>
 *     <Button>Cancel</Button>
 *     <Button variant="danger">Delete</Button>
 *   </Modal.Footer>
 * </Modal>
 */
const ModalBase = React.forwardRef<HTMLDivElement, ModalProps>(
  ({ isOpen, onClose, title, className = '', children, ...props }, ref) => {
    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 z-modal flex items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        {/* Modal Content */}
        <div
          ref={ref}
          className={`
            relative w-full max-w-lg max-h-[90vh] overflow-y-auto
            bg-slate-800 border border-slate-700 rounded-lg
            shadow-xl z-modal
            animate-scale-in
            ${className}
          `}
          {...props}
        >
          {title && (
            <div className="border-b border-slate-700 px-6 py-4">
              <h2 className="text-heading-md text-text-primary">{title}</h2>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }
);

ModalBase.displayName = 'Modal';

interface ModalSectionProps extends React.HTMLAttributes<HTMLDivElement> {}

export const ModalBody = React.forwardRef<HTMLDivElement, ModalSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={`px-6 py-4 text-body-md text-text-secondary ${className}`} {...props}>
      {children}
    </div>
  )
);
ModalBody.displayName = 'ModalBody';

export const ModalFooter = React.forwardRef<HTMLDivElement, ModalSectionProps>(
  ({ className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={`border-t border-slate-700 px-6 py-4 flex justify-end gap-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
);
ModalFooter.displayName = 'ModalFooter';

export const Modal = Object.assign(ModalBase, {
  Body: ModalBody,
  Footer: ModalFooter,
}) as ModalComponent;

// ============================================
// BADGE COMPONENTS
// ============================================

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error';
}

/**
 * Modern Badge Component
 *
 * Usage:
 * <Badge variant="success">Active</Badge>
 * <Badge variant="error">Failed</Badge>
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'default', className = '', children, ...props }, ref) => {
    const variantStyles = {
      default: 'bg-slate-700 text-text-primary border border-slate-600',
      success: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50',
      warning: 'bg-amber-500/20 text-amber-400 border border-amber-500/50',
      error: 'bg-red-500/20 text-red-400 border border-red-500/50',
    };

    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center px-2.5 py-0.5 rounded-full
          text-caption-sm font-medium
          ${variantStyles[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

// ============================================
// ALERT COMPONENTS
// ============================================

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
}

/**
 * Modern Alert Component
 *
 * Usage:
 * <Alert type="success" title="Success">Changes saved successfully!</Alert>
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ type = 'info', title, className = '', children, ...props }, ref) => {
    const typeStyles = {
      info: 'bg-sky-500/10 border border-sky-500/30 text-sky-300',
      success: 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300',
      warning: 'bg-amber-500/10 border border-amber-500/30 text-amber-300',
      error: 'bg-red-500/10 border border-red-500/30 text-red-300',
    };

    return (
      <div
        ref={ref}
        className={`rounded-lg p-4 ${typeStyles[type]} ${className}`}
        {...props}
      >
        {title && <p className="font-semibold text-body-sm mb-1">{title}</p>}
        <p className="text-body-sm">{children}</p>
      </div>
    );
  }
);

Alert.displayName = 'Alert';

// ============================================
// LOADING STATE COMPONENTS
// ============================================

export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-700 rounded-lg ${className}`} />
);

export const LoadingSpinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sizeStyles = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={`${sizeStyles[size]} animate-spin border-4 border-slate-600 border-t-sky-500 rounded-full`} />
  );
};

// ============================================
// EXAMPLE USAGE COMPONENT
// ============================================

/**
 * Example showing how to use the modern components together
 */
export const ModernComponentExample = () => {
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  return (
    <div className="space-y-6 p-6">
      {/* Buttons */}
      <div>
        <h2 className="text-heading-md text-text-primary mb-4">Buttons</h2>
        <div className="flex gap-3 flex-wrap">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
      </div>

      {/* Cards */}
      <div>
        <h2 className="text-heading-md text-text-primary mb-4">Cards</h2>
        <Card variant="elevated">
          <Card.Header>Network Status</Card.Header>
          <Card.Body>
            <p>All systems operational. 99.9% uptime this month.</p>
          </Card.Body>
        </Card>
      </div>

      {/* Forms */}
      <div>
        <h2 className="text-heading-md text-text-primary mb-4">Form Inputs</h2>
        <div className="max-w-sm">
          <Input label="Email" placeholder="user@example.com" />
          <Input label="Password" type="password" error="Password is too weak" />
        </div>
      </div>

      {/* Badges */}
      <div>
        <h2 className="text-heading-md text-text-primary mb-4">Badges</h2>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="success">Active</Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="error">Failed</Badge>
        </div>
      </div>

      {/* Alerts */}
      <div>
        <h2 className="text-heading-md text-text-primary mb-4">Alerts</h2>
        <div className="space-y-3">
          <Alert type="success" title="Success">Configuration updated successfully</Alert>
          <Alert type="error" title="Error">Failed to apply changes</Alert>
        </div>
      </div>

      {/* Modal */}
      <Button onClick={() => setIsModalOpen(true)}>Open Modal</Button>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Confirm Action">
        <Modal.Body>Are you sure you want to proceed?</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary">Confirm</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};
