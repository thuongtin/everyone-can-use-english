import { useContext } from "react";
import { DictProviderContext } from "@renderer/context";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@renderer/components/ui";

export const DictSelect = () => {
  const { currentDictValue, dictSelectItems, handleSetCurrentDict } =
    useContext(DictProviderContext);

  return (
    <Select
      value={currentDictValue}
      onValueChange={(value: string) => handleSetCurrentDict(value)}
    >
      <SelectTrigger className="h-8 border-ej-line bg-ej-surface text-xs text-ej-ink2">
        <SelectValue title="asdf"></SelectValue>
      </SelectTrigger>
      <SelectContent>
        {dictSelectItems.map((item) => (
          <SelectItem value={item.value} key={item.value} className="text-xs">
            {item.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
