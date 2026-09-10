import {
  DictProviderContext,
  AppSettingsProviderContext,
} from "@/renderer/context";
import { useContext, useEffect, useState } from "react";
import {
  toast,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@renderer/components/ui";
import { EjButton } from "@renderer/components/enjoy";
import { BILINGUAL_DICTIONARIES } from "@/constants/bilingual-dictionaries";
import { t } from "i18next";
import { LoaderIcon, Trash2Icon } from "lucide-react";
import { DictRow } from "./dict-row";

type SelectHandler = (dict: DictItem) => void;

export const InstalledDictList = function (props: {
  onSelect: SelectHandler;
}) {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { installedDicts, reload } = useContext(DictProviderContext);
  const [tasks, setTasks] = useState<DecompressTask[]>([]);

  useEffect(() => {
    reload();

    EnjoyApp.decompress.dashboard().then((_tasks) => {
      setTasks(_tasks.filter((_task) => _task.type === "dict"));
    });

    EnjoyApp.decompress.onComplete((_: any, task: DecompressTask) => {
      if (task.type === "dict") reload();
    });

    EnjoyApp.decompress.onUpdate((_: any, _tasks: DecompressTask[]) => {
      setTasks(_tasks.filter((_task) => _task.type === "dict"));
    });

    return () => {
      EnjoyApp.decompress.removeAllListeners();
    };
  }, []);

  return (
    <>
      {tasks.map((task) => (
        <DecompressDictItem key={task.id} task={task} />
      ))}

      {installedDicts.map((item) => (
        <InstalledDictItem
          key={item.value}
          dict={item}
          onSelect={props.onSelect}
        />
      ))}
    </>
  );
};

const DecompressDictItem = function ({ task }: { task: DecompressTask }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span className="size-4 shrink-0 rounded-full border-[1.5px] border-ej-line2" />
      <LoaderIcon className="size-4 shrink-0 animate-spin text-ej-muted" />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ej-ink">{task.title}</div>
        <div className="mt-0.5 text-[11.5px] text-ej-muted">
          {t("decompressing")}
          <span className="ml-1 ej-tabular">{task.progress || 0}%</span>
        </div>
      </div>
    </div>
  );
};

const InstalledDictItem = function (props: {
  dict: DictItem;
  onSelect: SelectHandler;
}) {
  const { dict, onSelect } = props;
  const { settings, setDefault, reload, remove } =
    useContext(DictProviderContext);
  const [removing, setRemoving] = useState(false);

  const isDefault = settings.default === dict.value;

  useEffect(() => {
    if (settings.removing?.find((v) => v === dict.value)) {
      handleRemove();
    }
  }, []);

  async function handleRemove() {
    setRemoving(true);

    try {
      await remove(dict);
      // The list must always keep a usable default, so fall back to the
      // bundled English - Vietnamese dictionary.
      if (isDefault) {
        const [fallback] = BILINGUAL_DICTIONARIES;
        await setDefault({
          type: "preset",
          value: fallback.value,
          text: t(fallback.key),
        });
      }
      toast.success(t("dictRemoved"));
    } catch (err) {
      toast.error(err.message);
    }

    setRemoving(false);
    reload();
  }

  const meta =
    dict.type === "mdict" ? "MDX" : t("settings.importedDict");

  return (
    <DictRow
      name={dict.text}
      meta={meta}
      isDefault={isDefault}
      onSelect={() => onSelect(dict)}
      actions={
        removing ? (
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-ej-muted" />
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label={t("remove")}
                onClick={(event) => event.stopPropagation()}
                className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ej-muted transition-colors duration-ej hover:bg-ej-bad-soft hover:text-ej-bad"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent onClick={(event) => event.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base font-bold text-ej-ink">
                  {t("removeDictTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-ej-muted">
                  {t("removeDictDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <EjButton size="sm" variant="danger" onClick={handleRemove}>
                    {t("remove")}
                  </EjButton>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      }
    />
  );
};
