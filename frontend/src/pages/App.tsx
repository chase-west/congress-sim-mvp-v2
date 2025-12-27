import React, { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { 
  loadAcsDistricts,
  getRandomBill,
  uploadBill,
  type DistrictSummary, 
  type Bill,
  type Issue,
} from "../lib/api";
import { generateSyntheticDistricts } from "../lib/synthetic";
import { runSimulationClient, type SimResult, AVAILABLE_MODELS } from "../lib/simulation";
import { loadBills } from "../lib/synthetic_bills";

// UI Components
import { Layout } from "../components/ui/Layout";

// Icons
import { ArrowRight } from "lucide-react";

const issues: Issue[] = ["economy", "climate", "healthcare", "immigration", "education"];

// Auto-resizing textarea component
const AutoTextArea = ({ value, onChange, className, placeholder }: any) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      className={className}
      placeholder={placeholder}
      rows={1}
    />
  );
};

const FormattedBillText = ({ text }: { text: string }) => {
  if (!text) return null;
  
  return (
    <div className="space-y-4 font-serif text-black leading-relaxed text-sm">
      {text.split(/\n+/).map((line, i) => {
         const trimmed = line.trim();
         if (!trimmed) return null;
         
         // Headers: SECTION 1. or SEC. 2.
         if (trimmed.match(/^(SECTION|SEC\.)\s*\d+/i)) {
            return <h4 key={i} className="font-bold uppercase tracking-wide mt-6 mb-2 text-center text-base">{trimmed}</h4>;
         }
         
         // Subsections: (a), (b), (1)
         if (trimmed.match(/^\([a-z0-9]+\)/i)) {
             return <p key={i} className="pl-8 text-justify indent-0">{trimmed}</p>;
         }
         
         // Sub-subsections: (1), (A) if indented (hard to detect without existing tabs, but usually follows logic)
         // Just default paragraph
         return <p key={i} className="text-justify">{trimmed}</p>;
      })}
    </div>
  );
};

export default function App() {
  const [title, setTitle] = useState("Energy + Jobs Package");
  const [summary, setSummary] = useState("A package combining clean energy credits with workforce training.");
  const [textContent, setTextContent] = useState(""); 
  
  // Simulation Config
  const [repsPerDistrict, setRepsPerDistrict] = useState(1);
  const [rounds, setRounds] = useState(3);
  const [useLlm, setUseLlm] = useState(true);
  
  const [billInventory, setBillInventory] = useState<Bill[]>([]);
  const [llmModel, setLlmModel] = useState(AVAILABLE_MODELS[0].id);
  const [seed, setSeed] = useState<number | "">("");

  // Hidden vector state (still used internally)
  const [vec, setVec] = useState<Record<Issue, number>>({
    economy: 0.20, climate: 0.55, healthcare: 0.05, immigration: 0.00, education: 0.30,
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [dlProgress, setDlProgress] = useState<{ text: string; percent?: number } | null>(null);
  const [simStatus, setSimStatus] = useState<string>("");
  const [showFullText, setShowFullText] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [districts, setDistricts] = useState<DistrictSummary | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isEditingText, setIsEditingText] = useState(false);

  // File Upload Handler
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
      if (!e.target.files?.length) return;
      setLoading(true);
      setErr(null);
      try {
          const b = await uploadBill(e.target.files[0]);
          setTitle(b.title);
          setSummary(b.summary);
          setTextContent(b.text_content || "");
          setVec(b.issue_vector);
          // Show the text so they can see what happened
          setShowFullText(true);
          setIsEditingText(false);
      } catch(e:any) {
          setErr(e.message);
      } finally {
          setLoading(false);
          // Reset input
          if (fileInputRef.current) fileInputRef.current.value = "";
      }
  }

  // Load Initial Data
  useEffect(() => {
    (async () => {
         const bills = await loadBills();
         setBillInventory(bills);
         
         // Auto-load the first bill so we have details immediately
         if (bills.length > 0) {
            const b = bills[0];
            setTitle(b.title);
            setSummary(b.summary);
            // Ensure full text is loaded
            setTextContent(b.text_content || "");
            setVec(b.issue_vector);
         }
    })();
    
    (async () => {
        try {
            const s = await loadAcsDistricts({ year: 2022, state_fips: undefined, multiplier: 1, jitter: 0.15 });
            setDistricts(s);
        } catch (e: any) {
            console.error("Failed to load initial ACS districts:", e);
            const d = generateSyntheticDistricts(200);
            setDistricts({ source: "synthetic-frontend", count: d.length, meta: { type: "instant", default: true }, sample: d });
        }
    })();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (loading && result && scrollRef.current) {
        scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [result, loading]);

  async function run() {
    setLoading(true);
    setErr(null);
    setResult(null);
    setDlProgress(null);
    setSimStatus("Initializing...");
    
    // Calculate Total Members
    // If we have real districts, multiply count by repsPerDistrict
    // If fallback, default to 200 * reps? Or just 50 * reps.
    const baseCount = districts?.count || 100;
    const numMembers = baseCount * repsPerDistrict;

    // Initialize with final_passed undefined so UI knows it's pending
    // @ts-ignore
    const liveResult: SimResult = { members: [], rounds: [], final_passed: undefined, final_statements: {}, notes: [] };
    setResult(liveResult);

    try {
      let dSummary = districts;
      
      if (!dSummary?.sample?.length) {
           const d = generateSyntheticDistricts(numMembers);
           dSummary = { source: "fallback-synthetic", count: d.length, meta: { type: "fallback" }, sample: d };
      }
      
      const out = await runSimulationClient({
        bill: { title, summary, text_content: textContent, issue_vector: vec },
        districtSummary: dSummary!,
        numMembers,
        rounds,
        useLlm,
        llmConfig: useLlm ? {
          model: llmModel,
          onProgress: (text, percent) => {
              if (text.toLowerCase().includes("finish") || text.includes("100%")) {
                  setDlProgress({ text: "AI Model Synced.", percent: 100 });
              } else {
                  setDlProgress({ text, percent });
              }
          },
        } : undefined,
        seed: seed === "" ? null : seed,
        onInit: (members) => setResult((prev) => prev ? { ...prev, members } : prev),
        onSpeech: (rIdx, speech) => {
            setDlProgress(null);
            setResult((prev) => {
                if (!prev) return prev;
                const newRounds = [...prev.rounds];
                if (!newRounds[rIdx]) newRounds[rIdx] = { round_index: rIdx, speeches: [], vote: { yes:0, no:0, abstain:0, passed:false, threshold:0.5, rollCall:{} } };
                // Reverse append? No, standard append.
                newRounds[rIdx] = { ...newRounds[rIdx], speeches: [...newRounds[rIdx].speeches, speech] };
                return { ...prev, rounds: newRounds };
            });
            setSimStatus(`Analyzing: Member ${speech.member_id}`);
        },
        onRoundComplete: (round) => {
             setResult((prev) => {
                if (!prev) return prev;
                const newRounds = [...prev.rounds];
                newRounds[round.round_index] = round;
                // Only set final_passed if truly done? 
                // Checks for last round in 'out' later, but live updates:
                return { ...prev, rounds: newRounds };
            });
            setSimStatus(`Round ${round.round_index+1} Complete.`);
        },
        onPhase: (msg) => setSimStatus(msg),
        onVoteUpdate: (vote) => {
             // Real-time vote counts!
             setResult((prev) => {
                if (!prev) return prev;
                // Find current round (latest)
                const rounds = [...prev.rounds];
                const lastIdx = rounds.length - 1;
                if (lastIdx >= 0) {
                    rounds[lastIdx] = { ...rounds[lastIdx], vote };
                }
                return { ...prev, rounds };
             });
        }
      });
      setResult(out);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
      setDlProgress(null);
      setSimStatus("");
    }
  }

  async function fetchRealBill() {
    setErr(null);
    setLoading(true);
    try {
      const b = await getRandomBill();
      setTitle(b.title);
      setSummary(b.summary);
      setTextContent(b.text_content || b.summary || "");
      setVec(v => ({ ...v, ...b.issue_vector }));
    } catch (e: any) {
      setErr("Failed to fetch from Congress.gov: " + (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  }

  function generateInstantBill() {
    if (billInventory.length === 0) return;
    const b = billInventory[Math.floor(Math.random() * billInventory.length)];
    setTitle(b.title);
    setSummary(b.summary);
    setTextContent(b.text_content || "");
    setVec(b.issue_vector);
  }

  return (
    <Layout orbActive={loading}>
      <div className="min-h-screen text-white font-sans overflow-x-hidden">
        
        {/* Navigation */}
        <nav className="fixed top-0 w-full p-8 flex justify-between z-50 pointer-events-none mix-blend-difference">
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-[0.2em] uppercase">Congress</span>
            <span className="text-[10px] tracking-widest text-white/50">Simulation v2.0</span>
          </div>
          <div className="text-[10px] tracking-widest text-white/50 uppercase text-right">
             <span className="hidden md:inline">Legislative Intelligence System</span>
          </div>
        </nav>

        {/* Main Grid */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 min-h-screen items-center px-6 md:px-12 lg:px-24 gap-12 lg:gap-24">
          
          {/* LEFT COLUMN: Controls */}
          <div className="col-span-1 lg:col-span-6 space-y-12 py-24">
            
            {/* Bill Input Area */}
            <div>
              <div className="flex gap-6 mb-8 text-[10px] font-bold tracking-[0.2em] text-white/40">
                <button onClick={generateInstantBill} className="hover:text-white transition-colors uppercase border-b border-transparent hover:border-white pb-1">Auto Generate</button>
                <div className="w-px h-3 bg-white/20" />
                <button onClick={fetchRealBill} className="hover:text-white transition-colors uppercase border-b border-transparent hover:border-white pb-1">Real Bill</button>
                <div className="w-px h-3 bg-white/20" />
                <button onClick={() => fileInputRef.current?.click()} className="hover:text-white transition-colors uppercase border-b border-transparent hover:border-white pb-1">Upload File (PDF/Text)</button>
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept=".pdf,.txt,.html,.xml,.htm" />
              </div>
              
              <div className="space-y-8">
                <AutoTextArea 
                  value={title} 
                  onChange={(e: any)=>setTitle(e.target.value)} 
                  className="w-full bg-transparent text-4xl md:text-6xl font-bold tracking-tighter outline-none placeholder-white/10 border-none p-0 resize-none overflow-hidden leading-[1.1]"
                  placeholder="Insert Title"
                />
                
                <textarea 
                  value={summary} 
                  onChange={(e)=>setSummary(e.target.value)} 
                  className="w-full bg-transparent text-lg md:text-xl font-light leading-relaxed outline-none placeholder-white/20 border-none p-0 resize-none h-40 opacity-80"
                  placeholder="Describe the legislation purpose and parameters..."
                  onBlur={() => {
                     // If summary is empty but text exists, auto-fill summary
                     if (!summary && textContent) {
                         setSummary(textContent.slice(0, 300) + "...");
                     }
                  }}
                />

                {/* Full Text Toggle */}
                {textContent && (
                  <div className="pt-4 border-t border-white/5">
                    <button 
                      onClick={() => setShowFullText(!showFullText)} 
                      className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors flex items-center gap-2 mb-4"
                    >
                      {showFullText ? "- Hide Full Text" : "+ Show Full Legislation Text"}
                    </button>
                    {showFullText && (
                        <button 
                             onClick={() => setIsEditingText(!isEditingText)}
                             className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-4 ml-6"
                        >
                             {isEditingText ? "View Formatted" : "Edit Text"}
                        </button>
                    )}
                    <AnimatePresence>
                      {showFullText && (
                        <motion.div 
                          initial={{height:0, opacity:0}} animate={{height:'auto', opacity:1}} exit={{height:0, opacity:0}}
                          className="overflow-hidden"
                        >
                           <div className="bg-[#f0f0f0] text-black p-8 md:p-12 font-serif leading-relaxed text-sm max-h-[60vh] overflow-y-auto selection:bg-black selection:text-white shadow-2xl">
                              <div className="mb-8 text-center border-b-2 border-black pb-6">
                                 <h3 className="uppercase font-bold tracking-[0.2em] text-xs mb-2 text-black/60">
                                    118th CONGRESS &mdash; 2d Session
                                 </h3>
                                 <h1 className="uppercase font-bold text-2xl tracking-tighter max-w-lg mx-auto leading-tight">
                                    {title}
                                 </h1>
                              </div>
                              

                              
                              {isEditingText && (
                                <textarea 
                                    value={textContent}
                                    onChange={(e) => setTextContent(e.target.value)}
                                    className="w-full h-[50vh] bg-white text-black font-mono text-xs p-4 border border-black/20 mt-4 focus:outline-none focus:border-black"
                                    placeholder="Paste or type bill text here..."
                                />
                              )}
                              {!isEditingText && <FormattedBillText text={textContent} />}
                              
                              <div className="mt-12 pt-8 border-t border-black/10 text-[10px] text-center text-black/40 uppercase tracking-widest font-sans">
                                 &mdash; End of Document &mdash;
                              </div>
                           </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>

            {/* Sim Controls */}
            <div className="space-y-6 pt-8 border-t border-white/10">
              {/* Primary Action Button */}
              <div>
                <button 
                  onClick={() => run()} 
                  disabled={loading}
                  className="w-full group flex items-center justify-between gap-4 text-xs font-bold tracking-[0.2em] uppercase hover:text-white/70 transition-colors py-4 border-b border-white hover:border-white/70"
                >
                  {loading ? (
                    <span className="animate-pulse">
                      {dlProgress ? (
                        <span className="flex items-center gap-2">
                          {dlProgress.text}
                          {dlProgress.percent !== undefined && <span className="opacity-50">[{dlProgress.percent}%]</span>}
                        </span>
                      ) : (
                        simStatus || "Processing Simulation..."
                      )}
                    </span>
                  ) : (
                    <>
                      Initiate Simulation
                      <div className="w-8 h-[1px] bg-white group-hover:w-16 transition-all duration-500 ease-out" />
                    </>
                  )}
                </button>
                
                {/* Loader Bar */}
                {loading && dlProgress?.percent && (
                   <div className="mt-4 w-full h-[1px] bg-white/10 relative overflow-hidden">
                      <div className="absolute top-0 left-0 h-full bg-white transition-all duration-300" style={{width: `${dlProgress.percent}%`}} />
                   </div>
                )}
                {loading && simStatus && !dlProgress && (
                   <div className="mt-2 text-[10px] uppercase tracking-widest text-white/30 animate-pulse text-right">Status: {simStatus}</div>
                )}
              </div>

               {/* Advanced Settings Toggle */}
               <div>
                  <button 
                    onClick={() => setShowAdvanced(!showAdvanced)} 
                    className="text-[10px] uppercase tracking-widest text-white/30 hover:text-white transition-colors flex items-center gap-2"
                  >
                    {showAdvanced ? "- Hide System Config" : "+ Configure System"}
                  </button>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div 
                        initial={{height:0, opacity:0}} animate={{height:'auto', opacity:1}} exit={{height:0, opacity:0}}
                        className="overflow-hidden"
                      >
                         <div className="pt-8 space-y-8 pb-4">
                            
                            {/* Reps Per District */}
                            <div className="space-y-4">
                               <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/50">
                                  <span>Reps Per District</span>
                                  <span className="text-white">{repsPerDistrict}x</span>
                               </div>
                               <input 
                                  type="range" min="1" max="5" step="1" 
                                  value={repsPerDistrict} 
                                  onChange={(e) => setRepsPerDistrict(Number(e.target.value))}
                                  className="w-full h-[1px] bg-white/20 accent-white appearance-none cursor-pointer hover:bg-white/40 transition-colors"
                               />
                               <div className="text-[10px] text-white/30 font-mono">
                                  Total Members: {(districts?.count || 0) * repsPerDistrict}
                               </div>
                            </div>

                            {/* AI Model Selector */}
                            <div className="space-y-4">
                               <div className="text-[10px] uppercase tracking-widest text-white/50">Intelligence Model</div>
                               <div className="grid gap-2">
                                  {AVAILABLE_MODELS.map(m => (
                                     <button 
                                        key={m.id}
                                        onClick={() => setLlmModel(m.id)}
                                        className={`text-left text-[10px] uppercase tracking-widest py-2 px-3 border border-white/10 hover:border-white/30 transition-all ${llmModel === m.id ? 'bg-white text-black border-white' : 'text-white/50'}`}
                                     >
                                        {m.label}
                                     </button>
                                  ))}
                               </div>
                            </div>

                         </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
               </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Results Stream */}
          <div className="col-span-1 lg:col-span-6 relative h-[80vh] flex flex-col justify-end pb-12">
             
             {/* IDLE STATE */}
             {!result && !loading && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-10 pointer-events-none">
                   <div className="text-[10px] uppercase tracking-[0.5em] text-center mb-4">System Idle</div>
                   <div className="w-px h-24 bg-white mx-auto" />
                </div>
             )}
             
             {/* LIVE / RESULTS STATE */}
             {result && (
                <motion.div 
                  initial={{opacity:0}} 
                  animate={{opacity:1}} 
                  className="h-full overflow-y-auto pr-2 scrollbar-hide relative"
                  ref={scrollRef}
                >
                   {/* Results Header */}
                   <div className="sticky top-0 bg-[#050505]/95 backdrop-blur-xl z-20 py-6 border-b border-white/10 mb-8 flex justify-between items-end">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Verdict</div>
                        {/* Check final_passed explicitly for undefined to show 'VOTING' */}
                        <div className={`text-3xl font-bold tracking-tighter ${result.final_passed === true ? 'text-green-400' : result.final_passed === false ? 'text-red-400' : 'text-white/60'}`}>
                          {result.final_passed === true ? "PASSED" : result.final_passed === false ? "REJECTED" : "IN PROGRESS..."}
                        </div>
                      </div>
                      
                      {/* Live Counter */}
                      <div className="text-right">
                          <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">
                             {simStatus && simStatus.includes("VOTING") ? simStatus.split(":")[0] : "Status"}
                          </div>
                          <div className="text-xl font-mono tabular-nums tracking-wider text-white">
                            {(() => {
                               // If voting is actively in progress (simStatus has value), show that count if possible or keep existing logic
                               if (simStatus && simStatus.includes("VOTING")) {
                                  // Extract "40/440" from string "VOTING PROGRESS: 40/440 MEMBERS..."
                                  const match = simStatus.match(/(\d+\/\d+)/);
                                  if (match) return match[1];
                               }

                               const last = result.rounds[result.rounds.length - 1];
                               if (!last) return "Initializing...";
                               
                               if (last.vote) {
                                  const total = last.vote.yes + last.vote.no + last.vote.abstain;
                                  return `${total} / ${result.members.length} Voted`;
                               } else {
                                  return `Debating (${last.speeches.length} Speakers)`;
                               }
                            })()}
                          </div>
                      </div>
                   </div>

                   {/* Speech Stream */}
                   <div className="space-y-16">
                      {result.rounds.map((r, i) => (
                         <div key={i} className="pl-6 border-l border-white/[0.08]">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-8 -ml-[29px] flex items-center gap-4 bg-[#050505] py-1 w-fit pr-4">
                              <div className="w-1.5 h-1.5 rounded-full bg-white"/> 
                              Round 0{r.round_index + 1}
                            </div>
                            <div className="space-y-12">
                              {r.speeches.map((s, idx) => {
                                 // Cleanup text
                                 let text = s.text.replace(/^(I rise to|I vote (yes|no|aye|nay)|I support|I oppose)\s+/i, "");
                                 text = text.charAt(0).toUpperCase() + text.slice(1);
                                 
                                 return (
                                    <motion.div key={idx} initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{delay: 0.05}} className="space-y-3 group">
                                      <div className="flex justify-between items-baseline opacity-40 group-hover:opacity-100 transition-opacity">
                                         <div className="text-[10px] font-bold font-mono">REP_ID_{s.member_id}</div>
                                         <div className={`text-[10px] uppercase tracking-widest ${s.stance === "support" ? "text-green-500" : s.stance === "oppose" ? "text-red-500" : "text-yellow-500"}`}>
                                            {s.stance === "support" ? "+ AYE" : s.stance === "oppose" ? "- NAY" : "~ ABSTAIN"}
                                         </div>
                                      </div>
                                      <p className="text-lg md:text-xl font-light leading-relaxed text-white/80 group-hover:text-white transition-colors">"{text}"</p>
                                    </motion.div>
                                 );
                              })}
                              
                              {/* Amendment Block */}
                              {r.amendment && (
                                <motion.div 
                                  initial={{opacity:0}} animate={{opacity:1}} 
                                  className="my-8 p-6 bg-white/5 border border-white/10 rounded-sm relative overflow-hidden"
                                >
                                   <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500" />
                                   <h4 className="text-[10px] uppercase tracking-widest text-yellow-500 mb-2">Amendment Proposed</h4>
                                   <p className="text-sm font-mono text-white/90 leading-relaxed italic">
                                      "{r.amendment}"
                                   </p>
                                </motion.div>
                              )}

                              <div className="pt-6 pb-2 border-t border-white/5 flex gap-12 text-lg md:text-xl font-bold tracking-widest leading-none">
                                  {/* If vote exists AND has content (not just placeholder), use it. */}
                                  {(() => {
                                     const vote = r.vote;
                                     const hasVote = vote && vote.rollCall && Object.keys(vote.rollCall).length > 0;
                                     
                                     if (hasVote) {
                                        return (
                                          <>
                                            <span className="text-green-500">YES: {vote.yes}</span>
                                            <span className="text-red-500">NO: {vote.no}</span>
                                          </>
                                        );
                                     } else {
                                        // Count speeches
                                        const yes = r.speeches.filter(s => s.stance === 'support').length;
                                        const no = r.speeches.filter(s => s.stance === 'oppose').length;
                                        // Use slightly different opacity/style to denote "Floor Count" vs "Official Vote"
                                        return (
                                          <>
                                             <span className="text-green-500/60">YES: {yes}</span>
                                             <span className="text-red-500/60">NO: {no}</span>
                                          </>
                                        );
                                     }
                                  })()}
                              </div>
                            </div>
                         </div>
                      ))}
                      {/* Scroll anchor */}
                      <div ref={scrollRef} />
                   </div>
                </motion.div>
             )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
