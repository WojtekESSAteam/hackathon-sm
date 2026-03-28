# Hybrid Intelligence - ExecuTax

## How to Run the Project Locally

Follow these steps to set up and run the application on your local machine.

### 1. Prerequisites
Ensure you have the following installed on your system:
- **Node.js** (Recommended version: 18 or newer)
- **Android Studio** (for Android Emulator)
- **Xcode** (for iOS Simulator, macOS only)

### 2. Environment Variables
You need to provide a Gemini API key to run the AI features of the application.

Create a file named `.env.local` in the root directory of the project and add your API key:
```env
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Install Dependencies
Install all required `node_modules` using npm:
```bash
npm install
```

### 4. Run the Application

You can start the app on either an Android emulator or an iOS simulator.

**Run on Android Emulator:**
Make sure your Android emulator is running, then execute:
```bash
npm run android
```

**Run on iOS Simulator (macOS only):**
Make sure your iOS simulator is open, then execute:
```bash
npm run ios
```
