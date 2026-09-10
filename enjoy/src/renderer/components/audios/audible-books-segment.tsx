import { useState, useEffect, useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
  Progress,
} from "@renderer/components/ui";
import { t } from "i18next";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import {
  DefaultAudioLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { useNavigate } from "react-router-dom";
import { LoaderIcon } from "lucide-react";
import { EjSectionHeader } from "@renderer/components/enjoy";

export const AudibleBooksSegment = () => {
  const navigate = useNavigate();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [books, setBooks] = useState<AudibleBookType[]>([]);
  const [selectedBook, setSelectedBook] = useState<AudibleBookType | null>(
    null
  );
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const downloadSample = () => {
    if (!selectedBook.sample) return;

    setProgress(0);
    setDownloading(true);
    EnjoyApp.audios
      .create(selectedBook.sample, {
        name: selectedBook.title,
        coverUrl: selectedBook.cover,
      })
      .then((audio) => {
        if (!audio) return;
        navigate(`/audios/${audio.id}`);
      })
      .finally(() => {
        setDownloading(false);
      });
  };

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    const fetchAudibleBooks = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const cachedBooks = await EnjoyApp.cacheObjects.get("audible-books");
        if (!active) return;
        if (cachedBooks) {
          setBooks(cachedBooks);
          return;
        }
        if (!navigator.onLine) return;

        const response = await EnjoyApp.providers.audible.bestsellers();
        if (!active) return;
        const filteredBooks = (response?.books || []).filter(
          (book) => book.language === "English"
        );
        if (!filteredBooks.length) return;
        await EnjoyApp.cacheObjects.set("audible-books", filteredBooks, 60 * 60);
        if (active) setBooks(filteredBooks);
      } catch (error) {
        if (active) console.error(error);
      } finally {
        requestInFlight = false;
      }
    };

    const handleOnline = () => {
      void fetchAudibleBooks();
    };

    window.addEventListener("online", handleOnline);
    void fetchAudibleBooks();
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
    };
  }, [EnjoyApp]);

  useEffect(() => {
    if (!selectedBook) return;

    EnjoyApp.download.onState((_, downloadState) => {
      console.log(downloadState);
      const { state, received, total } = downloadState;
      if (state === "progressing") {
        setProgress(Math.floor((received / total) * 100));
      }
    });

    return () => {
      EnjoyApp.download.removeAllListeners();
    };
  }, [selectedBook]);

  if (!books?.length) return null;

  return (
    <section>
      <EjSectionHeader title={`${t("from")} Audible.com`} />

      <div className="ej-row pb-1">
        {books.map((book) => (
          <AudioBookCard
            key={book.title}
            book={book}
            onClick={() => setSelectedBook(book)}
          />
        ))}
      </div>

      <Dialog
        open={Boolean(selectedBook)}
        onOpenChange={(value) => {
          if (!value) setSelectedBook(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedBook?.title}</DialogTitle>
          </DialogHeader>

          {selectedBook && <AudioBookPlayer book={selectedBook} />}

          <div className="flex items-center mb-4 bg-ej-surface2 rounded-lg">
            <div className="aspect-square h-28 overflow-hidden rounded-l-lg">
              <img
                crossOrigin="anonymous"
                src={selectedBook?.cover}
                alt={selectedBook?.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 py-3 px-4 h-28">
              <div className="text-lg font-semibold line-clamp-1">
                {selectedBook?.title}
              </div>
              <div className="text-sm line-clamp-1 mb-2">
                {selectedBook?.subtitle}
              </div>
              <div className="text-xs text-ej-muted text-right">
                {t("author")}: {selectedBook?.author}
              </div>
              <div className="text-xs text-ej-muted text-right">
                {t("narrator")}: {selectedBook?.narrator}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => EnjoyApp.shell.openExternal(selectedBook?.url)}
              variant="ghost"
              className="mr-auto"
            >
              {t("buy")}
            </Button>

            <Button onClick={() => setSelectedBook(null)} variant="secondary">
              {t("cancel")}
            </Button>
            <Button onClick={downloadSample} disabled={downloading}>
              {downloading && (
                <LoaderIcon className="w-4 h-4 animate-spin mr-2" />
              )}
              {downloading
                ? progress < 100
                  ? t("downloading")
                  : t("importing")
                : t("downloadSample")}
            </Button>
          </DialogFooter>

          {downloading && progress > 0 && <Progress value={progress} />}
        </DialogContent>
      </Dialog>
    </section>
  );
};

const AudioBookPlayer = (props: { book: AudibleBookType }) => {
  const { book } = props;
  return (
    <MediaPlayer src={book.sample}>
      <MediaProvider />
      <DefaultAudioLayout icons={defaultLayoutIcons} />
    </MediaPlayer>
  );
};

const AudioBookCard = (props: {
  book: AudibleBookType;
  onClick?: () => void;
}) => {
  const { book, onClick } = props;

  return (
    <div onClick={onClick} className="group cursor-pointer min-w-0">
      <div className="aspect-square rounded-xl overflow-hidden border border-ej-line bg-ej-surface2 transition-transform duration-ej group-hover:-translate-y-[3px] group-hover:shadow-ej">
        <img
          crossOrigin="anonymous"
          src={book.cover}
          alt={book.title}
          loading="lazy"
          className="object-cover w-full h-full"
        />
      </div>
      <div className="mt-2 text-[13px] font-semibold text-ej-ink leading-snug line-clamp-2">
        {book.title}
      </div>
      <div className="mt-0.5 text-[11.5px] text-ej-muted truncate">
        {book.author}
      </div>
    </div>
  );
};
