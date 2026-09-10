type Dict = {
  name: string;
  fileName: string;
  title: string;
  pronunciation: boolean;
  lang: string;
  size: string;
  addition: string;
  hash: string;
  state?: DictState;
  downloadState?: DownloadStateType;
  decompressProgress?: string;
};

type DictState = "installed" | "decompressing" | "downloading" | "uninstall";
