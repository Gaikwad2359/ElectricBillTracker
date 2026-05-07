import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UploadCloud, File as FileIcon, AlertCircle, CheckCircle2, Zap, IndianRupee, Sun, Download, FileText, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ConsumerData {
  name: string | null;
  consumerNumber: string | null;
  sanctionedLoadKw: number | null;
  connectionType: string | null;
  currentMonthUnits: number | null;
  currentMonthBill: number | null;
  currentMonthDate: string | null;
}

interface BillProcessResult {
  consumer1: ConsumerData;
  consumer2: ConsumerData;
  excelBase64: string;
  excelFilename: string;
}

const queryClient = new QueryClient();

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillProcessResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

  const validateFile = (selectedFile: File): boolean => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
      setError("Please upload a PDF, PNG, JPG, or JPEG file");
      return false;
    }
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setError(`File must be less than ${MAX_FILE_SIZE_MB}MB`);
      return false;
    }
    return true;
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && validateFile(droppedFile)) {
      setFile(droppedFile);
      createPreview(droppedFile);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && validateFile(selectedFile)) {
      setFile(selectedFile);
      createPreview(selectedFile);
    }
  };

  const createPreview = (file: File) => {
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processBill = async () => {
    if (!file) {
      setError("Please upload a bill first");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/api/bills/process`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to process bill");
      }

      const data: BillProcessResult = await response.json();
      setResult(data);
      toast({
        title: "Success",
        description: "Bill processed successfully!",
      });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to process bill",
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
          Upload your electricity bill to get a solar recommendation in 30 seconds.
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
                } ${file ? "border-emerald-200 bg-emerald-50/30" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFileDrop}
                onClick={() => !file && fileInputRef.current?.click()}
                data-testid="zone-upload"
              >
                <input
                  type="file"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept={ACCEPTED_TYPES.join(",")}
                  data-testid="input-file"
                />

                <AnimatePresence mode="wait">
                  {!file ? (
                    <motion.div
                      key="upload-prompt"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex flex-col items-center cursor-pointer"
                    >
                      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                        <UploadCloud className="w-8 h-8 text-emerald-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-1">Click or drag and drop</h3>
                      <p className="text-sm text-gray-500">PDF, PNG, JPG up to 10MB</p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="file-info"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center"
                    >
                      {previewUrl ? (
                        <div className="relative w-32 h-32 mb-4 rounded-lg overflow-hidden shadow-sm border border-gray-200">
                          <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                          <FileIcon className="w-8 h-8 text-emerald-500" />
                        </div>
                      )}
                      <h3 className="text-lg font-semibold text-gray-800 mb-1 max-w-xs truncate" data-testid="text-filename">
                        {file.name}
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); clearFile(); }} data-testid="button-clear">
                        Remove file
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

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
                  disabled={!file || isProcessing}
                  data-testid="button-process"
                >
                  {isProcessing ? (
                    <>
                      <Spinner className="mr-2 text-white w-5 h-5" />
                      AI is reading your bill...
                    </>
                  ) : (
                    "Process Bill"
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
                <div className="flex items-center justify-center p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800 font-medium" data-testid="banner-success">
                  <CheckCircle2 className="w-6 h-6 mr-2 text-emerald-600" />
                  Extraction Complete!
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Consumer 1 */}
                  <Card className="border-0 shadow-md bg-white overflow-hidden" data-testid="card-consumer-1">
                    <div className="bg-emerald-600 text-white px-6 py-3 font-semibold text-lg flex items-center">
                      <Zap className="w-5 h-5 mr-2" />
                      Consumer 1
                    </div>
                    <CardContent className="p-6 space-y-3">
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Name</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.name || "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Consumer No</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.consumerNumber || "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Units This Month</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.currentMonthUnits != null ? `${result.consumer1.currentMonthUnits} kWh` : "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Bill Amount</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.currentMonthBill != null ? `Rs ${result.consumer1.currentMonthBill}` : "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Sanctioned Load</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.sanctionedLoadKw != null ? `${result.consumer1.sanctionedLoadKw} kW` : "--"}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Connection Type</span>
                        <span className="font-medium text-gray-900 text-right">{result.consumer1?.connectionType || "--"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Bill Month</span>
                        <span className="font-medium text-gray-900 text-right">
                          {result.consumer1?.currentMonthDate 
                            ? isNaN(Date.parse(result.consumer1.currentMonthDate))
                              ? result.consumer1.currentMonthDate 
                              : new Date(result.consumer1.currentMonthDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                            : "--"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Consumer 2 */}
                  {(result.consumer2?.name || result.consumer2?.currentMonthUnits != null) && (
                    <Card className="border-0 shadow-md bg-white overflow-hidden" data-testid="card-consumer-2">
                      <div className="bg-emerald-600 text-white px-6 py-3 font-semibold text-lg flex items-center">
                        <Zap className="w-5 h-5 mr-2" />
                        Consumer 2
                      </div>
                      <CardContent className="p-6 space-y-3">
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Name</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.name || "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Consumer No</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.consumerNumber || "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Units This Month</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.currentMonthUnits != null ? `${result.consumer2.currentMonthUnits} kWh` : "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Bill Amount</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.currentMonthBill != null ? `Rs ${result.consumer2.currentMonthBill}` : "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Sanctioned Load</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.sanctionedLoadKw != null ? `${result.consumer2.sanctionedLoadKw} kW` : "--"}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 pb-2">
                          <span className="text-gray-500">Connection Type</span>
                          <span className="font-medium text-gray-900 text-right">{result.consumer2?.connectionType || "--"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Bill Month</span>
                          <span className="font-medium text-gray-900 text-right">
                            {result.consumer2?.currentMonthDate 
                              ? isNaN(Date.parse(result.consumer2.currentMonthDate))
                                ? result.consumer2.currentMonthDate 
                                : new Date(result.consumer2.currentMonthDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                              : "--"}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

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
              {/* Optional connecting lines for larger screens */}
              <div className="hidden md:block absolute top-10 left-[20%] right-[20%] h-0.5 bg-gray-200 z-0"></div>
              
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 bg-white border border-gray-100 shadow-sm rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">1. Upload Bill</h3>
                <p className="text-gray-500 text-sm">Securely upload your electricity bill in PDF or image format.</p>
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
