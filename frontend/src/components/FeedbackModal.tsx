import { useState, useRef } from 'react';
import { X, Upload, FileText, Loader2, CheckCircle } from 'lucide-react';
import api from '../services/api';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  context?: string; // e.g., 'homepage', 'observe', 'appgen'
}

interface UploadedFile {
  id: string;
  name: string;
  type: 'image' | 'file';
  preview?: string;
  file: File;
}

export default function FeedbackModal({ isOpen, onClose, context = 'general' }: FeedbackModalProps) {
  const [feedback, setFeedback] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  };

  const addFiles = (fileList: File[]) => {
    const newFiles = fileList.map((file) => {
      const isImage = file.type.startsWith('image/');
      const preview = isImage ? URL.createObjectURL(file) : undefined;
      return {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: isImage ? ('image' as const) : ('file' as const),
        preview,
        file,
      };
    });
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleSubmit = async () => {
    if (!feedback.trim() && files.length === 0) {
      alert('Please provide feedback or attach files');
      return;
    }

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('feedback', feedback);
      formData.append('context', context);
      files.forEach((file) => {
        formData.append('files', file.file);
      });

      await api.submitFeedback(formData);
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setFeedback('');
        setFiles([]);
        onClose();
      }, 1500);
    } catch (error: any) {
      alert(error.message || 'Failed to submit feedback');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/35 dark:bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-cream-surface/95 dark:bg-slate-950/80 border border-border dark:border-white/10 shadow-[0_28px_80px_rgba(45,42,38,0.22)] dark:shadow-[0_28px_80px_rgba(0,0,0,0.55)] max-h-[90vh] overflow-auto backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-white/10 sticky top-0 bg-cream-surface/90 dark:bg-slate-950/70 backdrop-blur-xl">
          <div className="min-w-0">
            <h2 className="text-heading-sm font-semibold text-text-light-primary dark:text-text-primary">
            Share Your Feedback
            </h2>
            <p className="mt-0.5 text-[12px] text-text-light-secondary dark:text-text-secondary">
              Help us improve Naavik. Add a short note and (optionally) attach screenshots or logs.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-light-secondary dark:text-text-secondary hover:text-text-light-primary dark:hover:text-text-primary hover:bg-slate-100 dark:hover:bg-white/10 transition-colors duration-150 disabled:opacity-50"
            aria-label="Close feedback"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {submitted ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-500 mb-4" />
              <h3 className="text-heading-md font-semibold text-text-light-primary dark:text-text-primary mb-2">
                Thank you!
              </h3>
              <p className="text-body-md text-text-light-secondary dark:text-text-secondary">
                Your feedback has been received and will help us improve Naavik.
              </p>
            </div>
          ) : (
            <>
              {/* Drop Zone */}
              <div>
                <label className="block text-body-sm font-medium text-text-light-primary dark:text-text-primary mb-3">
                  Attachments
                </label>
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative rounded-2xl border-2 border-dashed transition-colors p-8 text-center ${
                    isDragging
                      ? 'border-tenant-primary bg-tenant-light/60 dark:bg-tenant-light/20'
                      : 'border-border bg-cream-bg/70 hover:border-tenant-primary/50 hover:bg-cream-surface-light/70 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/8'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-tenant-light/60 dark:bg-tenant-light/20 border border-tenant-primary/20 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-tenant-primary" />
                    </div>
                    <div>
                      <p className="text-body-sm font-semibold text-text-light-primary dark:text-text-primary">
                        Drag images or files here
                      </p>
                      <p className="text-caption-sm text-text-light-secondary dark:text-text-secondary mt-1">
                        Or browse from your computer
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleBrowseClick}
                      className="mt-2 px-4 py-2 rounded-xl bg-ui-btn text-ui-btn-fg text-caption-sm font-semibold hover:bg-ui-btn-hover transition-all duration-150 shadow-sm"
                    >
                      Browse Files
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileInputChange}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt"
                  />
                </div>

                {/* Uploaded Files */}
                {files.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {files.map((file) => (
                      <div key={file.id} className="relative group">
                        {file.type === 'image' && file.preview ? (
                          <img
                            src={file.preview}
                            alt={file.name}
                            className="w-full h-24 object-cover rounded-xl border border-slate-200/80 dark:border-white/10"
                          />
                        ) : (
                          <div className="w-full h-24 rounded-xl border border-slate-200/80 bg-cream-bg flex items-center justify-center dark:border-white/10 dark:bg-white/5">
                            <FileText className="w-6 h-6 text-text-light-secondary dark:text-text-secondary" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(file.id)}
                          className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg hover:bg-slate-800 dark:bg-white/15 dark:hover:bg-white/25"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <p className="text-caption-sm text-text-light-secondary dark:text-text-secondary mt-1 truncate">
                          {file.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Feedback Text */}
              <div>
                <label className="block text-body-sm font-medium text-text-light-primary dark:text-text-primary mb-3">
                  Your Feedback
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Share your thoughts, suggestions, or report issues..."
                  rows={5}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200/90 bg-cream-surface text-text-light-primary placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-tenant-primary/30 focus:border-tenant-primary transition-all duration-150 resize-none shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-text-primary dark:placeholder:text-slate-500"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-text-light-secondary dark:text-text-secondary">
                    Tip: include the site/USID and date if you’re reporting an Observe issue.
                  </p>
                  <p className="text-[11px] tabular-nums text-text-light-secondary dark:text-text-secondary">
                    {feedback.length}/2000
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200/80 bg-white/85 sticky bottom-0 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/60">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl border border-border text-text-light-primary hover:bg-slate-100 transition-all duration-150 disabled:opacity-50 font-semibold dark:border-white/10 dark:text-text-primary dark:hover:bg-white/8"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isLoading || (!feedback.trim() && files.length === 0)}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Feedback'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
