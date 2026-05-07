import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UploadCloud, File as FileIcon, AlertCircle, CheckCircle2, Zap, Sun, Download, FileText, Bot, X, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface MonthlyEntry {
  month: string;           
  consumer1Units: number | null;
  consumer1Bill: number | null;
  consumer2Units: number | null;
  consumer2Bill: number | null;
}

interface BillProcessResult {
  consumer1Name: string | null;
  consumer1Number: string | null;
  consumer1Load: number | null;
  consumer1Connection: string | null;
  consumer2Name: string | null;
  consumer2Number: string | null;
  consumer2Load: number | null;
  consumer2Connection: string | null;
  monthlyData: MonthlyEntry[];   
  totalFilesProcessed: number;
  excelBase64: string;
  excelFilename: string;
}

const queryClient = new QueryClient();

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_FILES = 12;

function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillProcessResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const addFiles = (newFiles: File[]) => {
    setError(null);
    setResult(null);
    
    const validFiles: File[] = [];
    let hasError = false;

    for (const file of newFiles) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`Invalid file type: ${file.name}. Please upload PDF, PNG, or JPG.`);
        hasError = true;
        break;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`File too large: ${file.name}. Max size is ${MAX_FILE_SIZE_MB}MB.`);
        hasError = true;
        break;
      }
      validFiles.push(file);
    }

    if (hasError) return;

    setFiles((prev) => {
      const combined = [...prev, ...validFiles];
      if (combined.length > MAX_FILES) {
        setError(`You can only upload up to ${MAX_FILES} files.`);
        return prev;
      }
      return combined;
    });
  };

  const removeFile = (indexToRemove: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const clearAllFiles = () => {
    setFiles([]);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processBill = async () => {
    if (files.length === 0) {
      setError("Please upload at least one bill");
      return;
    }
    if (files.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files allowed`);
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/bills/process`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to process bills");
      }

      const data: BillProcessResult = await response.json();
      setResult(data);
      toast({
        title: "Success",
        description: "Bills processed successfully!",
      });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to process bills",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadExcel = () => {
    if (!result || !result.excelBase64) return;
    try {
      const byteChars = atob(result.excelBase64);
      const byteNumbers = Array.from(byteChars).map((c) => c.charCodeAt(0));
      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.excelFilename || "solar_recommendation.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: "Could not generate the Excel file.",
      });
    }
  };

  const formatMonth = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex flex-col font-sans">
      {/* Header */}
      <header className="w-full py-12 px-4 text-center space-y-4">
        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-3 py-1 text-xs mb-4" data-testid="badge-header">
          AI-Powered | Instant | Free
        </Badge>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900" data-testid="text-title">
          <span className="bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">Energybase</span> Solar Calculator <Sun className="inline w-8 h-8 md:w-10 md:h-10 text-amber-500 mb-2" />
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto" data-testid="text-tagline">
          Upload your electricity bills to get a solar recommendation in 30 seconds.
        </p>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 pb-20 space-y-8">
        <div className="grid grid-cols-1 gap-8">
          {/* Upload Section */}
          <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl overflow-hidden bg-white/50 backdrop-blur-sm" data-testid="card-upload">
            <CardContent className="p-8">
              <div
                className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 ease-in-out ${
                  isDragging ? "border-emerald-500 bg-emerald-50 scale-[1.02]" : "border-gray-200 bg-gray-50 hover:border-emerald-300"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                data-testid="zone-upload"
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept={ACCEPTED_TYPES.join(",")}
                  data-testid="input-file"
                />

                <div className="flex flex-col items-center cursor-pointer pointer-events-none">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                    <UploadCloud className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Click or drag and drop bills here</h3>
                  <p className="text-sm text-gray-500">PDF, PNG, JPG up to 10MB (Max 12 files)</p>
                </div>
              </div>

              {/* File List */}
              {files.length > 0 && (
                <div className="mt-6 space-y-3" data-testid="list-files">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-medium text-gray-700" data-testid="text-file-count">
                      {files.length} file{files.length !== 1 ? 's' : ''} selected
                    </span>
                    <Button variant="ghost" size="sm" onClick={clearAllFiles} className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 px-2" data-testid="button-clear-all">
                      <Trash2 className="w-4 h-4 mr-1" />
                      Remove all
                    </Button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                    <AnimatePresence>
                      {files.map((f, idx) => (
                        <motion.div
                          key={`${f.name}-${idx}`}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg shadow-sm"
                          data-testid={`item-file-${idx}`}
                        >
                          <div className="flex items-center space-x-3 overflow-hidden">
                            <FileIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-sm font-medium text-gray-900 truncate" title={f.name}>{f.name}</span>
                              <span className="text-xs text-gray-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile(idx)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            data-testid={`button-remove-file-${idx}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-center text-red-600 bg-red-50 p-3 rounded-md" data-testid="alert-error">
                  <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                  <span className="text-sm font-medium">{error}</span>
                </motion.div>
              )}

              <div className="mt-8 flex justify-center">
                <Button
                  size="lg"
                  className={`w-full sm:w-auto min-w-[200px] h-14 text-lg font-medium rounded-full shadow-lg hover:shadow-xl transition-all ${
                    isProcessing ? "bg-emerald-600 opacity-90" : "bg-emerald-600 hover:bg-emerald-700 hover:-translate-y-0.5"
                  }`}
                  onClick={processBill}
                  disabled={files.length === 0 || isProcessing}
                  data-testid="button-process"
                >
                  {isProcessing ? (
                    <>
                      <Spinner className="mr-2 text-white w-5 h-5" />
                      AI is reading {files.length} bill{files.length !== 1 ? 's' : ''}...
                    </>
                  ) : (
                    `Process Bills (${files.length} file${files.length !== 1 ? 's' : ''})`
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Results Section */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
                data-testid="section-results"
              >
                <div className="flex items-center justify-center p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800 font-medium shadow-sm" data-testid="banner-success">
                  <CheckCircle2 className="w-6 h-6 mr-2 text-emerald-600" />
                  Processed {result.totalFilesProcessed} of {files.length} files successfully
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Consumer 1 Info */}
                  <Card className="border-0 shadow-md bg-white overflow-hidden" data-testid="card-consumer-1">
                    <div className="bg-emerald-600 text-white px-6 py-3 font-semibold text-lg flex items-center">
                      <Zap className="w-5 h-5 mr-2" />
                      Consumer 1
                    </div>
                    <CardContent className="p-6 space-y-3">
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Name</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1Name || "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Consumer No</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1Number || "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Sanctioned Load</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1Load != null ? `${result.consumer1Load} kW` : "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Connection Type</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1Connection || "--"}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Consumer 2 Info */}
                  {(result.consumer2Name || result.consumer2Number) && (
                    <Card className="border-0 shadow-md bg-white overflow-hidden" data-testid="card-consumer-2">
                      <div className="bg-emerald-600 text-white px-6 py-3 font-semibold text-lg flex items-center">
                        <Zap className="w-5 h-5 mr-2" />
                        Consumer 2
                      </div>
                      <CardContent className="p-6 space-y-3">
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Name</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2Name || "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Consumer No</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2Number || "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Sanctioned Load</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2Load != null ? `${result.consumer2Load} kW` : "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Connection Type</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2Connection || "--"}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Monthly Data Table */}
                {result.monthlyData && result.monthlyData.length > 0 && (
                  <Card className="border-0 shadow-md bg-white overflow-hidden" data-testid="card-monthly-data">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-100">
                      <h3 className="font-semibold text-gray-900">Monthly Consumption Data</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-600 border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-3 font-medium whitespace-nowrap">Month</th>
                            <th className="px-6 py-3 font-medium text-right">C1 Units</th>
                            <th className="px-6 py-3 font-medium text-right">C1 Bill (₹)</th>
                            {(result.consumer2Name || result.consumer2Number) && (
                              <>
                                <th className="px-6 py-3 font-medium text-right">C2 Units</th>
                                <th className="px-6 py-3 font-medium text-right">C2 Bill (₹)</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {result.monthlyData.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50 transition-colors" data-testid={`row-monthly-${idx}`}>
                              <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">{formatMonth(row.month)}</td>
                              <td className="px-6 py-3 text-right text-gray-600">{row.consumer1Units != null ? row.consumer1Units : "--"}</td>
                              <td className="px-6 py-3 text-right text-gray-600">{row.consumer1Bill != null ? row.consumer1Bill : "--"}</td>
                              {(result.consumer2Name || result.consumer2Number) && (
                                <>
                                  <td className="px-6 py-3 text-right text-gray-600">{row.consumer2Units != null ? row.consumer2Units : "--"}</td>
                                  <td className="px-6 py-3 text-right text-gray-600">{row.consumer2Bill != null ? row.consumer2Bill : "--"}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                <div className="flex justify-center pt-4">
                  <Button
                    size="lg"
                    className="h-14 px-8 text-lg font-bold rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    onClick={downloadExcel}
                    data-testid="button-download"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Excel Report
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* How It Works Section */}
          <div className="pt-16 pb-8">
            <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">How It Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center relative">
              <div className="hidden md:block absolute top-10 left-[20%] right-[20%] h-0.5 bg-gray-200 z-0"></div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">1. Upload Bills</h3>
                <p className="text-gray-500 text-sm">Upload one PDF or multiple bill images (up to 12 months).</p>
              </div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center mb-4">
                  <Bot className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">2. AI Reads Data</h3>
                <p className="text-gray-500 text-sm">Our AI extracts consumption, load, and tariff instantly.</p>
              </div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center mb-4">
                  <Download className="w-8 h-8 text-amber-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">3. Get Excel</h3>
                <p className="text-gray-500 text-sm">Download a customized solar recommendation report.</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-8 border-t border-gray-200 bg-white text-center mt-auto">
        <p className="text-sm text-gray-500 font-medium" data-testid="text-footer">
          Made for Energybase | AI Intern Task
        </p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Home />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
