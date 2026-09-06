type BilingualDirection = "en-vi" | "vi-en";
type BilingualEntry = {
  word: string;
  pos: string;
  ipa: { text: string; labels: string[] }[];
  sourceUrl: string;
  editorialNote?: string;
  editorialSourceUrl?: string;
  senses: {
    glosses: string[];
    tags: string[];
    examples: { text: string; translation: string }[];
  }[];
};
