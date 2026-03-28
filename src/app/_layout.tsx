import { Stack } from "expo-router";
import { initExecutorch } from "react-native-executorch";
import { ExpoResourceFetcher } from "react-native-executorch-expo-resource-fetcher";

initExecutorch({ resourceFetcher: ExpoResourceFetcher });
import { StatusBar } from "react-native";

export default function RootLayout() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0A0A0A" },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="upload" />
        <Stack.Screen name="processing" />
        <Stack.Screen name="summary" />
      </Stack>
    </>
  );
}
