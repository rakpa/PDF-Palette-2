import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, File, X, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  file: File;
  id: string;
  preview?: string;
}

/** Human-readable size that doesn't collapse small files to "0.00 MB". */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export interface UploadLabels {
  dropzone: string;
  button: string;
  invalidType: string;
}

function labelsFromAccept(accept: Record<string, string[]>): UploadLabels {
  const exts = [...new Set(Object.values(accept).flat())];

  if (exts.length === 1 && exts[0] === ".pdf") {
    return {
      dropzone: "Drag & drop PDF files here",
      button: "Select PDF files",
      invalidType: "Please upload PDF files only.",
    };
  }

  if (exts.some((e) => e === ".doc" || e === ".docx") && !exts.includes(".pdf")) {
    return {
      dropzone: "Drag & drop Word documents here",
      button: "Select Word file",
      invalidType: "Please upload a .doc or .docx file.",
    };
  }

  if (exts.every((e) => [".jpg", ".jpeg", ".png"].includes(e))) {
    return {
      dropzone: "Drag & drop images here",
      button: "Select images",
      invalidType: "Please upload JPG or PNG images.",
    };
  }

  const names = exts.map((e) => e.replace(".", "").toUpperCase()).join(", ");
  return {
    dropzone: "Drag & drop files here",
    button: "Select files",
    invalidType: `Please upload a supported file (${names}).`,
  };
}

interface FileUploaderProps {
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  labels?: Partial<UploadLabels>;
  className?: string;
  compact?: boolean;
}

const FileUploader = ({
  accept = { "application/pdf": [".pdf"] },
  maxFiles = 10,
  maxSize = 100 * 1024 * 1024, // 100MB
  files,
  onFilesChange,
  labels: labelsOverride,
  className,
  compact = false,
}: FileUploaderProps) => {
  const [error, setError] = useState<string | null>(null);
  const labels = useMemo(
    () => ({ ...labelsFromAccept(accept), ...labelsOverride }),
    [accept, labelsOverride]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: { errors: { code?: string }[] }[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        const rejection = rejectedFiles[0];
        if (rejection.errors[0]?.code === "file-too-large") {
          setError(`File is too large. Maximum size is ${maxSize / 1024 / 1024}MB`);
        } else if (rejection.errors[0]?.code === "file-invalid-type") {
          setError(labels.invalidType);
        } else {
          setError("Some files were rejected.");
        }
        return;
      }

      if (files.length + acceptedFiles.length > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed.`);
        return;
      }

      const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
        file,
        id: `${file.name}-${Date.now()}-${Math.random()}`,
      }));

      onFilesChange([...files, ...newFiles]);
    },
    [files, labels.invalidType, maxFiles, maxSize, onFilesChange]
  );

  const removeFile = (id: string) => {
    onFilesChange(files.filter((f) => f.id !== id));
    setError(null);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const reordered = [...files];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onFilesChange(reordered);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: maxFiles - files.length,
    maxSize,
    disabled: files.length >= maxFiles,
  });

  return (
    <div className={cn(compact ? "space-y-3" : "space-y-4", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "relative cursor-pointer rounded-xl border-2 border-dashed text-center transition-all",
          compact ? "p-5 md:p-6" : "rounded-2xl p-8",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/50",
          files.length >= maxFiles && "cursor-not-allowed opacity-50"
        )}
      >
        <input {...getInputProps()} />
        <motion.div
          initial={false}
          animate={{ scale: isDragActive ? 1.02 : 1 }}
          className={cn("flex flex-col items-center", compact ? "gap-2.5" : "gap-4")}
        >
          {!compact && (
            <div
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full transition-colors",
                isDragActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              <Upload className="h-8 w-8" />
            </div>
          )}
          <div>
            <p
              className={cn(
                "font-semibold text-foreground",
                compact ? "text-lg md:text-xl" : "text-lg"
              )}
            >
              {isDragActive ? "Drop your files here" : labels.dropzone}
            </p>
            <p
              className={cn(
                "mt-0.5 text-muted-foreground",
                compact ? "text-base" : "text-sm"
              )}
            >
              {compact ? "or drop files here" : "or click to browse from your computer"}
            </p>
          </div>
          <Button
            type="button"
            size={compact ? "lg" : "default"}
            variant={compact ? "default" : "outline"}
            className={cn(compact && "min-w-[200px] text-base font-semibold")}
            disabled={files.length >= maxFiles}
          >
            {labels.button}
          </Button>
          <p className="text-xs text-muted-foreground">
            Up to {maxFiles} file{maxFiles === 1 ? "" : "s"}, max {maxSize / 1024 / 1024}MB each
          </p>
        </motion.div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            {files.map((uploadedFile, index) => (
              <motion.div
                key={uploadedFile.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                {files.length > 1 && (
                  <div className="flex shrink-0 flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-6 text-muted-foreground disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => moveFile(index, -1)}
                      aria-label={`Move ${uploadedFile.file.name} earlier`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-6 text-muted-foreground disabled:opacity-30"
                      disabled={index === files.length - 1}
                      onClick={() => moveFile(index, 1)}
                      aria-label={`Move ${uploadedFile.file.name} later`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <File className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {uploadedFile.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(uploadedFile.file.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeFile(uploadedFile.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </motion.div>
            ))}
            {files.length > 1 && (
              <p className="text-center text-xs text-muted-foreground">
                Use the arrows to change the order files are combined in.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FileUploader;
