import { Stack } from "expo-router";
import { initExecutorch } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });

export default function RootLayout() {
  return <Stack />;
}
