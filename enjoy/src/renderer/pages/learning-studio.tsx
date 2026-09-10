import { LearningStudio } from "../components/learning/learning-studio";

export default function LearningStudioPage() {
  return <LearningStudio bridge={window.__ENJOY_APP__.learning} />;
}
