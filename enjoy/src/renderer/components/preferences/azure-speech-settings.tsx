import { useContext, useEffect, useState } from "react";
import { Button, toast } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingSecretInput,
} from "./settings-primitives";

export const AzureSpeechSettings = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    void EnjoyApp.speeches
      .getAzureConfig()
      .then((config) => {
        setRegion(config.region);
        setEndpoint(config.endpoint);
        setConfigured(config.configured || config.transcriptionConfigured);
      })
      .catch(() => {
        setRegion("");
        setEndpoint("");
        setConfigured(false);
      });
  }, [EnjoyApp]);

  const save = async () => {
    try {
      const config = await EnjoyApp.speeches.setAzureConfig({
        region,
        endpoint,
        ...(key.trim() ? { key: key.trim() } : {}),
      });
      setKey("");
      setRegion(config.region);
      setEndpoint(config.endpoint);
      setConfigured(config.configured || config.transcriptionConfigured);
      window.dispatchEvent(new Event("azure-speech-config-updated"));
      toast.success("Đã lưu cấu hình Azure Speech.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu Azure Speech.");
    }
  };

  return (
    <SettingGroup title="Azure Speech và MAI Transcribe">
      <SettingCard>
        <SettingRow
          label="Resource endpoint"
          description="Dùng cho chép lời MAI-Transcribe-2 và Speech Fast Transcription. TTS và chấm phát âm dùng region bên dưới."
        >
          <input
            aria-label="Azure Speech resource endpoint"
            className="h-9 w-80 rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs text-ej-ink"
            value={endpoint}
            placeholder="https://resource.cognitiveservices.azure.com"
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Region"
          description={configured ? "Đã lưu key an toàn trên máy này." : "Cần subscription key và region riêng của Azure Speech."}
        >
          <input
            className="h-9 w-44 rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs text-ej-ink"
            value={region}
            placeholder="eastus"
            onChange={(event) => setRegion(event.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Subscription key"
          description="Để trống để giữ key đã lưu."
        >
          <SettingSecretInput
            value={key}
            placeholder={configured ? "••••••••" : "Nhập key"}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
          />
        </SettingRow>
        <div className="flex justify-end px-4 pb-4">
          <Button type="button" size="sm" onClick={() => void save()}>
            Lưu Azure Speech
          </Button>
        </div>
      </SettingCard>
    </SettingGroup>
  );
};
