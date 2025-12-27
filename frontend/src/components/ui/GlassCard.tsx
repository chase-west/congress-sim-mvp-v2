import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  className?: string;
  variant?: 'dark' | 'light';
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className, variant = 'dark', ...props }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={clsx(
        "backdrop-blur-xl rounded-2xl border transition-colors duration-300",
        variant === 'dark' 
          ? "bg-black/40 border-white/5 hover:border-white/10"
          : "bg-white/5 border-white/10 hover:bg-white/10",
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
};
