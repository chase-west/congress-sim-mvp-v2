import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GovernanceOrb } from './GovernanceOrb';

export const Layout: React.FC<{ children: React.ReactNode; orbActive?: boolean }> = ({ children, orbActive }) => {
  return (
    <div className="relative min-h-screen font-sans text-white selection:bg-neon-blue selection:text-black">
      {/* 3D Background Layer */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-60">
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
          <GovernanceOrb active={orbActive} />
        </Canvas>
      </div>

      {/* Content Layer */}
      <div className="relative z-10 p-6 md:p-12 max-w-7xl mx-auto">
         {children}
      </div>
    </div>
  );
};
