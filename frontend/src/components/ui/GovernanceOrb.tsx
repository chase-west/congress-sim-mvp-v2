import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface GovernanceOrbProps {
  active?: boolean;
}

export const GovernanceOrb: React.FC<GovernanceOrbProps> = ({ active }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef1 = useRef<THREE.Mesh>(null);
  const ringRef2 = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (!meshRef.current || !ringRef1.current || !ringRef2.current) return;
    const t = state.clock.getElapsedTime();
    
    // Very slow, majestic rotation
    meshRef.current.rotation.y = t * 0.05;
    meshRef.current.rotation.x = t * 0.02;

    ringRef1.current.rotation.x = t * 0.05;
    ringRef1.current.rotation.y = t * 0.05;
    
    ringRef2.current.rotation.x = t * 0.03 + Math.PI / 2;
    ringRef2.current.rotation.y = t * 0.02;

    // React to active state
    if (active) {
       meshRef.current.rotation.y += 0.05;
    }
  });

  return (
    <>
      <color attach="background" args={['#050505']} />
      
      {/* Subtle Fog for depth */}
      <fog attach="fog" args={['#050505', 5, 20]} />

      <ambientLight intensity={1} />
      
      <group position={[2, 0, -2]}> {/* Offset to the right slightly */}
        {/* Main Architectural Wireframe */}
        <mesh ref={meshRef}>
          <icosahedronGeometry args={[2.5, 1]} /> 
          <meshBasicMaterial 
            color="#333333"
            wireframe
            transparent
            opacity={0.1}
          />
        </mesh>

        {/* Inner Solid Core - Dark Matter */}
        <mesh scale={0.8}>
           <icosahedronGeometry args={[2, 4]} />
           <meshBasicMaterial color="#000000" />
        </mesh>

        {/* Orbitals */}
        <mesh ref={ringRef1}>
           <torusGeometry args={[3.5, 0.005, 16, 100]} />
           <meshBasicMaterial color="#444444" transparent opacity={0.3} />
        </mesh>
        
        <mesh ref={ringRef2}>
           <torusGeometry args={[4, 0.005, 16, 100]} />
           <meshBasicMaterial color="#444444" transparent opacity={0.3} />
        </mesh>
      </group>
    </>
  );
};
