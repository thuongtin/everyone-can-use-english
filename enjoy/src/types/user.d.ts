type UserType = {
  id: string;
  name?: string;
  nameSource?: "explicit" | "discovered" | "default" | "database";
  email?: string;
  balance?: number;
  avatarUrl?: string;
  accessToken?: string;
  recordingsCount?: number;
  recordingsDuration?: number;
  hasMixin?: boolean;
  following?: boolean;
  createdAt?: string;
};
