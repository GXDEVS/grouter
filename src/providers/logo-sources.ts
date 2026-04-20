export interface LogoSourceEntry {
  providerId: string;
  pngUrl: string;
  sourcePage: string;
  verifiedAt: string;
  notes?: string;
}

export const OFFICIAL_LOGO_SOURCES: LogoSourceEntry[] = [
  {
    providerId: "cerebras",
    pngUrl: "https://cdn.sanity.io/images/e4qjo92p/production/995ad1057fa5bd3fa9e071629e59891a0ba4bce6-1500x500.png?auto=format&dpr=1&fit=max&q=75&w=750",
    sourcePage: "https://www.cerebras.ai/company/press-kit",
    verifiedAt: "2026-04-20",
    notes: "Official press kit logo (PNG).",
  },
  {
    providerId: "mistral",
    pngUrl: "https://mistral.ai/static/branding/mistral-logo-color-black.png",
    sourcePage: "https://mistral.ai/brand",
    verifiedAt: "2026-04-20",
    notes: "Official Mistral logo asset.",
  },
  {
    providerId: "together",
    pngUrl: "https://cdn.prod.website-files.com/69654e88dce9154b5f1206dd/69a6dad66e8b98c718262888_together-ai-logo-suite.zip",
    sourcePage: "https://www.together.ai/brand",
    verifiedAt: "2026-04-20",
    notes: "Brand kit zip; script handles direct PNG fallback by existing local asset.",
  },
  {
    providerId: "huggingface",
    pngUrl: "https://huggingface.co/datasets/huggingface/brand-assets/resolve/main/hf-logo.png?download=true",
    sourcePage: "https://huggingface.co/brand",
    verifiedAt: "2026-04-20",
    notes: "Official HF brand assets dataset PNG.",
  },
  {
    providerId: "modal",
    pngUrl: "https://modal-cdn.com/modal-logo-icon.png",
    sourcePage: "https://modal.com/blog/what-is-modals-logo",
    verifiedAt: "2026-04-20",
    notes: "Official Modal logo icon PNG.",
  },
];
