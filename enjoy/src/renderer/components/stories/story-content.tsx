import { useState, useEffect } from "react";
import nlp from "compromise";
import paragraphs from "compromise-paragraphs";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";
nlp.plugin(paragraphs);

export const StoryContent = (props: { content: string }) => {
  const { content } = props;
  if (!content) return null;

  const [paragraphs, setParagraphs] = useState<
    { terms: any[]; text: string }[][]
  >([]);
  const doc = nlp<{
    paragraphs: () => { json: () => { terms: any[]; text: string }[][] };
  }>(content);
  doc.cache();

  useEffect(() => {
    setParagraphs(doc.paragraphs().json());
  }, [content.trim()]);

  return (
    <>
      {paragraphs.map((sentences, i: number) => (
        <p key={`paragraph-${i}`} className="">
          {sentences.map((sentence, i: number) => {
            if (sentence.text.match(/!\[\]\(\S+\)/g)) {
              const [img] = sentence.text.match(/!\[\]\(\S+\)/g);
              const src = displayableResourceUrl(
                img.replace(/!\[\]\(/g, "").replace(/\)/g, "")
              );
              if (!src) return null;
              return (
                <p key={`paragraph-${i}`}>
                  <img src={src} />
                </p>
              );
            } else {
              return (
                <span
                  className="sentence select-auto whitespace-normal"
                  key={`sentence-${i}`}
                >
                  {sentence.terms.map((term) => (
                    <span key={term.id} className="">
                      {term.pre}
                      {term.text}
                      {term.post}
                    </span>
                  ))}
                </span>
              );
            }
          })}
        </p>
      ))}
    </>
  );
};
