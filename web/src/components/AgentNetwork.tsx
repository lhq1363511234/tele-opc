import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AgentDefinition, AgentRunRecord } from '../types';

interface AgentNetworkProps {
  agents: AgentDefinition[];
  runs: AgentRunRecord[];
}

const coreAgentIds = ['chief_of_staff', 'domain_router', 'skill_router', 'crm', 'finance', 'browser', 'email', 'calendar', 'ops'];

export function AgentNetwork({ agents, runs }: AgentNetworkProps) {
  const [webglAvailable, setWebglAvailable] = useState(true);
  const selectedAgents = coreAgentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentDefinition => Boolean(agent));

  useEffect(() => {
    setWebglAvailable(hasWebGLSupport());
  }, []);

  if (!webglAvailable) {
    return <AgentNetworkFallback agents={selectedAgents} runs={runs} />;
  }

  return (
    <div className="network-shell">
      <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={['#101412']} />
        <ambientLight intensity={0.8} />
        <pointLight position={[4, 4, 6]} intensity={1.4} color="#f4c95d" />
        <CanvasResizer />
        <NetworkScene agents={selectedAgents} runs={runs} />
      </Canvas>
      <div className="network-legend">
        {selectedAgents.slice(0, 6).map((agent) => (
          <span key={agent.id}>
            <i className={agent.mode === 'approval_gated' ? 'risk' : ''} />
            {agent.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentNetworkFallback({ agents, runs }: AgentNetworkProps) {
  const runningAgents = new Set(runs.filter((run) => run.status === 'running').map((run) => run.agent_id));
  return (
    <div className="network-shell network-fallback">
      <div className="fallback-network">
        {agents.map((agent, index) => {
          const angle = (index / Math.max(agents.length, 1)) * Math.PI * 2;
          const x = 50 + Math.cos(angle) * 32;
          const y = 50 + Math.sin(angle) * 32;
          const active = runningAgents.has(agent.id);
          return (
            <div
              key={agent.id}
              className={`fallback-node ${agent.mode === 'approval_gated' ? 'risk' : ''} ${active ? 'active' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span>{agent.displayName}</span>
            </div>
          );
        })}
        <div className="fallback-core">Chief</div>
      </div>
      <div className="network-legend">
        {agents.slice(0, 6).map((agent) => (
          <span key={agent.id}>
            <i className={agent.mode === 'approval_gated' ? 'risk' : ''} />
            {agent.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

function hasWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function CanvasResizer() {
  const { gl } = useThree();

  const resize = () => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width > 0 && height > 0 && (gl.domElement.width !== width || gl.domElement.height !== height)) {
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      gl.setSize(width, height, false);
    }
  };

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;

    resize();
    const timeout = window.setTimeout(resize, 100);
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [gl]);

  useFrame(resize);

  return null;
}

function NetworkScene({ agents, runs }: AgentNetworkProps) {
  const groupRef = useRef<THREE.Group>(null);
  const runningAgents = new Set(runs.filter((run) => run.status === 'running').map((run) => run.agent_id));
  const nodes = useMemo(() => {
    const radius = 2.65;
    return agents.map((agent, index) => {
      const angle = (index / Math.max(agents.length, 1)) * Math.PI * 2;
      return {
        agent,
        position: new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      };
    });
  }, [agents]);

  const edges = useMemo(() => {
    const chief = nodes.find((node) => node.agent.id === 'chief_of_staff') ?? nodes[0];
    if (!chief) return [];
    return nodes
      .filter((node) => node.agent.id !== chief.agent.id)
      .map((node) => new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([chief.position, node.position]),
        new THREE.LineBasicMaterial({ color: '#6aa398', transparent: true, opacity: 0.55 })
      ));
  }, [nodes]);

  useFrame((_, delta) => {
    if (groupRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      groupRef.current.rotation.z += delta * 0.04;
    }
  });

  return (
    <group ref={groupRef}>
      {edges.map((line, index) => (
        <primitive key={`edge-${index}`} object={line} />
      ))}
      {nodes.map(({ agent, position }) => {
        const active = runningAgents.has(agent.id);
        const gated = agent.mode === 'approval_gated';
        return (
          <mesh key={agent.id} position={position}>
            <sphereGeometry args={[active ? 0.18 : 0.13, 24, 24]} />
            <meshStandardMaterial
              color={active ? '#f4c95d' : gated ? '#ef6f6c' : '#72b7b2'}
              emissive={active ? '#4a3500' : '#061917'}
              roughness={0.35}
              metalness={0.15}
            />
          </mesh>
        );
      })}
    </group>
  );
}
