import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

interface NeonButtonProps extends HTMLMotionProps<"button"> {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
}

export const NeonButton: React.FC<NeonButtonProps> = ({ 
  children, 
  className, 
  loading, 
  variant = 'primary', 
  icon,
  ...props 
}) => {
  const variants = {
    primary: "bg-white text-black hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] border-transparent",
    secondary: "bg-transparent border-white/20 text-white hover:bg-white/5 hover:border-white/40",
    danger: "bg-neon-red/10 border-neon-red/50 text-neon-red hover:bg-neon-red/20 hover:shadow-[0_0_15px_rgba(255,0,85,0.3)]",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        "relative rounded-xl px-6 py-3 font-semibold text-sm transition-all duration-200 border flex items-center justify-center gap-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin w-4 h-4" /> : icon}
      {children}
    </motion.button>
  );
};
