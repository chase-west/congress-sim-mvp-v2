import React from "react";
import { motion } from "framer-motion";

export const About: React.FC = () => {
  return (
    <div className="pt-24 md:pt-32 pb-12 max-w-4xl mx-auto space-y-24">
      {/* Header Section */}
      <section className="space-y-6">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-6xl font-bold tracking-tighter uppercase"
        >
          Democratizing <br/> <span className="text-white/40">Legislative Intelligence</span>
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-lg md:text-xl text-white/70 leading-relaxed max-w-2xl font-light"
        >
          Congress Simulation v2 is an advanced agentic framework designed to predict the outcomes of legislation before it even reaches the floor. By modeling individual representative incentives using Local LLMs, we create a transparent, deterministic look at democracy.
        </motion.p>
      </section>

      {/* How to Use Section */}
      <section className="space-y-12">
        <div className="flex items-center gap-4">
           <div className="h-px bg-white/20 flex-grow" />
           <span className="text-[10px] uppercase tracking-[0.3em] text-white/40">Operational Manual</span>
           <div className="h-px bg-white/20 flex-grow" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
                {
                    step: "01",
                    title: "Ingest Legislation",
                    desc: "Provide raw legislative text via PDF upload, direct input, or auto-generate a synthetic bill based on current events."
                },
                {
                    step: "02",
                    title: "Configure Agents",
                    desc: "Adjust the simulation parameters. Set the number of representatives, choose your preferred AI model (Qwen, Llama, etc.), and allocate GPU resources."
                },
                {
                    step: "03",
                    title: "Analyze & Predict",
                    desc: "Run the simulation. Watch in real-time as AI agents debate, amend, and vote. Receive a final pass/fail probability and breakdown."
                }
            ].map((item, i) => (
                <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 * i }}
                    className="space-y-4 group"
                >
                    <div className="text-4xl font-bold text-white/10 group-hover:text-white/30 transition-colors font-mono">{item.step}</div>
                    <h3 className="text-lg font-bold uppercase tracking-widest">{item.title}</h3>
                    <p className="text-sm text-white/60 leading-relaxed">{item.desc}</p>
                </motion.div>
            ))}
        </div>
      </section>

      {/* Deep Dive Section */}
      <section className="space-y-12">
        <div className="flex items-center gap-4">
           <div className="h-px bg-white/20 flex-grow" />
           <span className="text-[10px] uppercase tracking-[0.3em] text-white/40">The Decision Engine</span>
           <div className="h-px bg-white/20 flex-grow" />
        </div>

        <div className="space-y-16">
           {/* Step 1 */}
           <div className="grid md:grid-cols-12 gap-8 items-start">
              <div className="md:col-span-4">
                 <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-2">Phase 01</div>
                 <h3 className="text-xl font-bold uppercase tracking-tighter">Synthetic Profiling</h3>
              </div>
              <div className="md:col-span-8 space-y-4 text-white/70 font-light leading-relaxed">
                 <p>
                    The system generates <strong className="text-white">hundreds of distinct representative agents</strong>, each anchored to real-world data constants. Unlike standard chatbots, these agents possess persistent state:
                 </p>
                 <ul className="list-disc pl-4 space-y-2 text-sm md:text-base">
                    <li><strong className="text-white">District Demographics:</strong> Census ACS data provides accurate population weighting (e.g., Urban Professional vs. Rural Agrarian).</li>
                    <li><strong className="text-white">Political Ideology:</strong> A numerical spectrum derived from historical election leanings (PVI).</li>
                    <li><strong className="text-white">Donor/Issue Weights:</strong> Randomized but consistent prioritization of issues like Economy, Climate, or Defense.</li>
                 </ul>
              </div>
           </div>

           {/* Step 2 */}
            <div className="grid md:grid-cols-12 gap-8 items-start">
              <div className="md:col-span-4">
                 <div className="text-[10px] uppercase tracking-widest text-blue-400 mb-2">Phase 02</div>
                 <h3 className="text-xl font-bold uppercase tracking-tighter">Local Inference</h3>
              </div>
              <div className="md:col-span-8 space-y-4 text-white/70 font-light leading-relaxed">
                 <p>
                    When a bill is introduced, every single agent performs an independent inference cycle using the local Large Language Model (WebLLM). This occurs in parallel (optimized for WebGPU). The prompt structure enforces rigorous logic:
                 </p>
                    <div className="bg-white/5 p-4 rounded-sm border-l-2 border-white/20 font-mono text-xs text-white/50">
                        <p className="mb-2 italic">"You are Rep [ID]. Your district leans [LEAN]. Your top priorities are [WEIGHTS]."</p>
                        <p className="mb-2 text-white/80">CORE LOGIC:</p>
                        <p className="mb-1">1. <span className="text-white">Party Check:</span> Does this align with national platform?</p>
                        <p className="mb-1">2. <span className="text-white">District Check:</span> Does this help my specific voters?</p>
                        <p className="mb-1 text-emerald-400">3. If <span className="font-bold">EITHER</span> Party <span className="font-bold">OR</span> District = YES {'->'} VOTE YES.</p>
                        <p className="text-white/50 text-[10px] pl-4 mb-1">*(Includes Party Loyalty & Maverick behavior)*</p>
                        <p className="text-red-400">4. If <span className="font-bold">NEITHER</span> align {'->'} VOTE NO.</p>
                     </div>
              </div>
           </div>

           {/* Step 3 */}
           <div className="grid md:grid-cols-12 gap-8 items-start">
              <div className="md:col-span-4">
                 <div className="text-[10px] uppercase tracking-widest text-purple-400 mb-2">Phase 03</div>
                 <h3 className="text-xl font-bold uppercase tracking-tighter">Emergent Negotiation</h3>
              </div>
              <div className="md:col-span-8 space-y-4 text-white/70 font-light leading-relaxed">
                 <p>
                    The simulation is not static. If a bill fails or is controversial, the system triggers an <strong className="text-white">Amendment Loop</strong>.
                 </p>
                 <p>
                    "Key Representatives" (a statistically selected cross-section from extremes to moderates) generate speeches explaining their stance. The system then aggregates these grievances and prompts the AI to draft a compromise amendment.
                 </p>
              </div>
           </div>
        </div>
      </section>

      {/* Technical Specs */}
      <section className="grid md:grid-cols-2 gap-12 pt-12 border-t border-white/10">
         <div>
            <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-6">Core Architecture</h3>
            <ul className="space-y-4 font-mono text-xs text-white/70">
                <li className="flex justify-between border-b border-white/5 pb-2">
                    <span>Frontend Runtime</span>
                    <span>React + Vite + WebGPU</span>
                </li>
                <li className="flex justify-between border-b border-white/5 pb-2">
                    <span>Backend Engine</span>
                    <span>FastAPI + Python 3.11</span>
                </li>
                <li className="flex justify-between border-b border-white/5 pb-2">
                    <span>Inference</span>
                    <span>Local WebLLM / Ollama</span>
                </li>
                 <li className="flex justify-between border-b border-white/5 pb-2">
                    <span>State Management</span>
                    <span>Deterministic Seeded RNG</span>
                </li>
            </ul>
         </div>
         <div>
             <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-6">About the Project</h3>
             <p className="text-sm text-white/60 leading-relaxed mb-6">
                This project is open-source and dedicated to bringing transparency to the legislative process. It runs entirely locally on your machine to ensure privacy and zero latency.
             </p>
             <a href="https://github.com/chase-west/congress-sim-mvp-v2" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs uppercase tracking-widest border-b border-white hover:text-white/70 hover:border-white/70 transition-colors pb-1">
                View Source on GitHub ↗
             </a>
         </div>
      </section>
    </div>
  );
};
