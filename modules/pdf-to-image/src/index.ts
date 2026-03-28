import { requireNativeModule } from "expo-modules-core";

interface PageResult {
  uri: string;
  width: number;
  height: number;
  page: number;
}

const PdfToImage = requireNativeModule("PdfToImage");

/**
 * Convert all pages of a PDF to JPEG images.
 * @param fileUri - file:// URI to the PDF
 * @param quality - JPEG quality 0-100 (default 90)
 * @returns Array of page results with uri, width, height, page number
 */
export async function convertPdfToImages(
  fileUri: string,
  quality: number = 90
): Promise<PageResult[]> {
  return PdfToImage.convert(fileUri, quality);
}
