import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { VideoPlayer } from "@renderer/components";
import { MediaShadowProvider } from "@renderer/context";

export default () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const segmentIndex = searchParams.get("segmentIndex") || "0";
  const navigate = useNavigate();

  return (
    <div className="h-content flex flex-col relative max-w-full min-h-0">
      <MediaShadowProvider onCancel={() => navigate("/videos")}>
        <VideoPlayer id={id} segmentIndex={parseInt(segmentIndex)} />
      </MediaShadowProvider>
    </div>
  );
};
