import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FileUp, Download, Copy, CheckCircle, AlertCircle, Loader2, ExternalLink, Upload, Library } from 'lucide-react';

interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: Array<{ family: string; given: string } | { literal: string }>;
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  publisher?: string;
}

interface CsvRow {
  [key: string]: string;
}

interface GenerationResult {
  success: boolean;
  citations: string[];
  errors: string[];
  warnings: string[];
  csvData: CsvRow[];
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [gsheetUrl, setGsheetUrl] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [cslFile, setCslFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'warning' }>({ message: '', type: 'info' });
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateStatus = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    setStatus({ message, type });
    setDebugInfo(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${type.toUpperCase()}: ${message}`]);
  }, []);

  const addDebugInfo = useCallback((info: string) => {
    setDebugInfo(prev => [...prev, `[${new Date().toLocaleTimeString()}] DEBUG: ${info}`]);
  }, []);

  useEffect(() => {
    const checkLibraries = () => {
      const hasCSL = (window as any).CSL || (window as any).citeproc;
      const hasPapa = (window as any).Papa;
      
      if (hasCSL && hasPapa) {
        setLibrariesLoaded(true);
        updateStatus('External libraries loaded successfully.', 'success');
        addDebugInfo(`CSL (${(window as any).CSL ? 'CSL' : 'citeproc'}) and PapaParse are available on the window object.`);
        return true;
      }
      return false;
    };

    if (checkLibraries()) {
      return; // Exit if libraries are already loaded
    }

    updateStatus('Waiting for external libraries to load...', 'info');
    addDebugInfo('Starting to poll for CSL and PapaParse libraries...');

    const intervalId = setInterval(() => {
      if (checkLibraries()) {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
      }
    }, 200); // Check every 200ms

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      if (!librariesLoaded) {
        addDebugInfo('Library loading timed out after 10 seconds. Attempting manual library check...');
        
        // Final attempt to check for libraries with different names
        const finalCSLCheck = (window as any).CSL || (window as any).citeproc || (window as any).CiteprocEngine;
        const finalPapaCheck = (window as any).Papa;
        
        if (finalCSLCheck && finalPapaCheck) {
          setLibrariesLoaded(true);
          updateStatus('External libraries loaded successfully (after retry).', 'success');
          addDebugInfo('Libraries found on final check.');
        } else {
          updateStatus('Failed to load external libraries. Please check your network connection and refresh the page.', 'error');
          addDebugInfo(`Final check - CSL: ${!!finalCSLCheck}, Papa: ${!!finalPapaCheck}`);
        }
      }
    }, 15000); // 15-second timeout

    // Cleanup function to clear intervals and timeouts when the component unmounts
    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [updateStatus, addDebugInfo, librariesLoaded]);


  const mapSourceType = (rawType: string): string => {
    if (!rawType || typeof rawType !== 'string') return 'article-journal';
    const type = rawType.toLowerCase().trim();
    const mapping: Record<string, string> = {
      'journal article': 'article-journal',
      'journal': 'article-journal',
      'article': 'article-journal',
      'news article': 'article-newspaper',
      'newspaper': 'article-newspaper',
      'magazine': 'article-magazine',
      'book': 'book',
      'book chapter': 'chapter',
      'chapter': 'chapter',
      'conference paper': 'paper-conference',
      'conference': 'paper-conference',
      'thesis': 'thesis',
      'dissertation': 'thesis',
      'report': 'report',
      'webpage': 'webpage',
      'website': 'webpage',
      'blog post': 'post-weblog',
      'blog': 'post-weblog',
      'review': 'review'
    };
    return mapping[type] || 'webpage';
  };

  const parseAuthors = (authorCell: string): Array<{ family: string; given: string } | { literal: string }> => {
    if (!authorCell || typeof authorCell !== 'string' || !authorCell.trim()) return [];
    
    const authorStr = authorCell.trim();
    let authorList: string[] = [];

    if (authorStr.includes(';')) {
      authorList = authorStr.split(';').map(a => a.trim());
    } else if (authorStr.includes(' & ')) {
      authorList = authorStr.split(' & ').map(a => a.trim());
    } else if (authorStr.includes(' and ')) {
      authorList = authorStr.split(' and ').map(a => a.trim());
    } else {
      authorList = [authorStr];
    }

    const cslAuthors: Array<{ family: string; given: string } | { literal: string }> = [];
    for (const author of authorList) {
      if (!author) continue;

      if (author.includes(',')) {
        const parts = author.split(',', 2).map(p => p.trim());
        if (parts.length === 2 && parts[0] && parts[1]) {
          cslAuthors.push({ family: parts[0], given: parts[1] });
        }
      } else {
        const parts = author.split(' ');
        if (parts.length > 1 && parts[0].length > 1) {
          cslAuthors.push({ family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') });
        } else {
          cslAuthors.push({ literal: author });
        }
      }
    }
    return cslAuthors;
  };

  const parseVolumeIssue = (cell: string): { volume: string | null; issue: string | null } => {
    if (!cell || typeof cell !== 'string') return { volume: null, issue: null };
    const text = cell.trim();
    const patterns = [
      /(\d+)\s*\(\s*(\d+)\s*\)/,
      /vol\.?\s*(\d+)\s*no\.?\s*(\d+)/i,
      /v\.?\s*(\d+)\s*n\.?\s*(\d+)/i,
      /(\d+)\s*[-–—]\s*(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { volume: match[1], issue: match[2] };
    }
    if (/^\d+$/.test(text)) return { volume: text, issue: null };
    return { volume: null, issue: null };
  };

  const createCslItem = (row: CsvRow, index: number): CslItem => {
    const item: CslItem = {
      id: `item_${index + 1}`,
      type: mapSourceType(row['Source Type'] || row['type'] || '')
    };

    // Essential fields validation
    if (row['Title'] || row['title']) {
      item.title = String(row['Title'] || row['title']).trim();
    } else {
      addDebugInfo(`Item ${index + 1}: Missing title`);
    }
    
    const authors = parseAuthors(row['Author(s)'] || row['Authors'] || row['Author'] || row['author']);
    if (authors.length > 0) {
      item.author = authors;
    } else {
      addDebugInfo(`Item ${index + 1}: No valid authors found`);
    }

    const year = row['Year'] || row['Publication Year'] || row['Date'] || row['year'];
    if (year && !isNaN(parseInt(year, 10))) {
      item.issued = { 'date-parts': [[parseInt(year, 10)]] };
    } else {
      addDebugInfo(`Item ${index + 1}: Invalid or missing year: ${year}`);
    }

    const containerTitle = row['Journal'] || row['Publication'] || row['Container Title'] || row['Source'] || row['container-title'];
    if (containerTitle) {
      item['container-title'] = String(containerTitle).trim();
    }

    const volIss = parseVolumeIssue(row['Volume'] || row['Volume-Issue'] || row['volume'] || '');
    if (volIss.volume) item.volume = volIss.volume;
    if (volIss.issue) item.issue = volIss.issue;
    else if (row['Issue'] || row['issue']) item.issue = String(row['Issue'] || row['issue']).trim();

    const pages = row['Pages'] || row['Page Range'] || row['Page'] || row['page'];
    if (pages) item.page = String(pages).trim();

    // Handle DOI/URL
    const doiField = row['DOI'] || row['DOI/URL'] || row['doi'];
    if (doiField) {
      let doi = String(doiField).trim();
      if (doi.startsWith('http')) {
        if (doi.includes('doi.org/')) {
          doi = doi.replace(/^https?:\/\/doi\.org\//, '');
          item.DOI = doi;
        } else {
          item.URL = doi;
        }
      } else if (doi.startsWith('10.')) {
        item.DOI = doi;
      }
    }
    
    const url = row['URL'] || row['url'];
    if (url && !item.DOI && !item.URL) {
      if (String(url).trim().startsWith('http')) {
        item.URL = String(url).trim();
      }
    }

    if (row['Publisher'] || row['publisher']) {
      item.publisher = String(row['Publisher'] || row['publisher']).trim();
    }

    addDebugInfo(`Created CSL item ${index + 1}: ${JSON.stringify(item, null, 2)}`);
    return item;
  };

  const validateCslItems = (items: CslItem[]): { valid: CslItem[]; errors: string[] } => {
    const valid: CslItem[] = [];
    const errors: string[] = [];

    items.forEach((item, index) => {
      const itemErrors: string[] = [];
      
      if (!item.title && !item.author) {
        itemErrors.push(`Item ${index + 1}: Missing both title and author`);
      }
      
      if (item.type === 'article-journal' && !item['container-title']) {
        itemErrors.push(`Item ${index + 1}: Journal articles require a journal name`);
      }

      if (itemErrors.length === 0) {
        valid.push(item);
      } else {
        errors.push(...itemErrors);
      }
    });

    return { valid, errors };
  };

  const generateCitations = async (cslItems: CslItem[], cslStyle: string, locale: string): Promise<{ citations: string[]; errors: string[] }> => {
    const errors: string[] = [];
    
    try {
      addDebugInfo(`Initializing CSL engine with ${cslItems.length} items`);
      
      // Check if CSL is available
      const CSLEngine = (window as any).CSL || (window as any).citeproc || (window as any).CiteprocEngine;
      if (typeof CSLEngine === 'undefined') {
        throw new Error('CSL library not loaded. Please refresh the page and try again.');
      }
      
      // Validate and clean CSL style
      if (!cslStyle || !cslStyle.includes('<style')) {
        throw new Error('Invalid CSL style: not a valid XML document');
      }

      const sys = {
        retrieveLocale: () => {
          addDebugInfo('Retrieving locale');
          return locale;
        },
        retrieveItem: (id: string) => {
          const item = cslItems.find(item => item.id === id);
          addDebugInfo(`Retrieving item ${id}: ${item ? 'found' : 'not found'}`);
          return item;
        }
      };
      
      // Initialize CSL engine with error handling
      let engine;
      try {
        engine = new CSLEngine.Engine(sys, cslStyle);
        addDebugInfo('CSL engine initialized successfully');
      } catch (engineError) {
        addDebugInfo(`CSL engine initialization failed: ${engineError}`);
        throw new Error(`Failed to initialize citation engine: ${engineError}`);
      }
      
      const itemIDs = cslItems.map(item => item.id);
      addDebugInfo(`Updating items: ${itemIDs.join(', ')}`);
      
      try {
        engine.updateItems(itemIDs);
        addDebugInfo('Items updated in engine');
      } catch (updateError) {
        addDebugInfo(`Failed to update items: ${updateError}`);
        throw new Error(`Failed to update citation items: ${updateError}`);
      }
      
      try {
        const bib = engine.makeBibliography();
        addDebugInfo(`Bibliography generated: ${bib ? 'success' : 'failed'}`);
        
        if (bib && bib[1] && Array.isArray(bib[1]) && bib[1].length > 0) {
          const citations = bib[1].map((citationHtml: string, index: number) => {
            try {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = citationHtml;
              const cleanText = tempDiv.textContent?.replace(/\s+/g, ' ').trim() || '';
              addDebugInfo(`Citation ${index + 1} processed: ${cleanText.substring(0, 100)}...`);
              return cleanText;
            } catch (citationError) {
              const errorMsg = `Failed to process citation ${index + 1}: ${citationError}`;
              addDebugInfo(errorMsg);
              errors.push(errorMsg);
              return `Error processing citation ${index + 1}`;
            }
          });
          
          return { citations, errors };
        } else {
          addDebugInfo('No bibliography generated or empty result');
          throw new Error('Bibliography generation returned empty result');
        }
      } catch (bibError) {
        addDebugInfo(`Bibliography generation failed: ${bibError}`);
        throw new Error(`Failed to generate bibliography: ${bibError}`);
      }
      
    } catch (error) {
      const errorMsg = `Citation generation failed: ${error}`;
      addDebugInfo(errorMsg);
      errors.push(errorMsg);
      return { citations: [], errors };
    }
  };

  const buildCsvUrl = (shareUrl: string): string => {
    const match = /\/d\/([a-zA-Z0-9-_]+)/.exec(shareUrl);
    if (!match || !match[1]) {
      throw new Error('Invalid Google Sheets URL format. Please ensure you\'re using a sharing URL.');
    }
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=0`;
  };

  const parseCsv = (csvText: string): Promise<CsvRow[]> => {
    return new Promise((resolve, reject) => {
      // Check if Papa is available
      const Papa = (window as any).Papa;
      if (typeof Papa === 'undefined') {
        reject(new Error('CSV parsing library not loaded. Please refresh the page and try again.'));
        return;
      }
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
        complete: (results: any) => {
          if (results.errors.length) {
            addDebugInfo(`CSV parsing errors: ${JSON.stringify(results.errors)}`);
            reject(new Error(`CSV Parsing Error: ${results.errors[0].message}`));
          } else {
            addDebugInfo(`CSV parsed successfully: ${results.data.length} rows`);
            resolve(results.data);
          }
        },
        error: (error: any) => {
          addDebugInfo(`CSV parsing failed: ${error.message}`);
          reject(new Error(`CSV Parsing Failed: ${error.message}`));
        }
      });
    });
  };

  const getCslStyle = async (): Promise<string> => {
    if (cslFile) {
      updateStatus('Reading custom CSL style file...');
      const content = await cslFile.text();
      addDebugInfo(`Custom CSL file loaded: ${content.length} characters`);
      return content;
    } else {
      updateStatus('Fetching default APA 7 citation style...');
      const response = await fetch('https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl');
      if (!response.ok) {
        throw new Error(`Could not download APA CSL style: ${response.statusText}`);
      }
      const content = await response.text();
      addDebugInfo(`Default APA CSL loaded: ${content.length} characters`);
      return content;
    }
  };

  const fetchResource = async (url: string, resourceName: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not download ${resourceName}: ${response.statusText}`);
    }
    const content = await response.text();
    addDebugInfo(`${resourceName} loaded: ${content.length} characters`);
    return content;
  };

  const handleGeneration = async (): Promise<void> => {
    if (!gsheetUrl && !csvFile) {
      updateStatus('Please provide a Google Sheet URL or upload a CSV file.', 'error');
      return;
    }

    if (!librariesLoaded) {
      updateStatus('Citation libraries are still loading. Please wait a moment and try again.', 'error');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setDebugInfo(['Starting citation generation...']);

    try {
      let csvText: string;
      if (gsheetUrl) {
        const csvUrl = buildCsvUrl(gsheetUrl);
        updateStatus('Fetching data from Google Sheet...');
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error(`Failed to fetch from Google Sheet: ${response.statusText}`);
        csvText = await response.text();
        addDebugInfo(`Google Sheet data fetched: ${csvText.length} characters`);
      } else if (csvFile) {
        updateStatus('Reading CSV file...');
        csvText = await csvFile.text();
        addDebugInfo(`CSV file read: ${csvText.length} characters`);
      } else {
        throw new Error('No data source provided');
      }

      updateStatus('Parsing CSV data...');
      const jsonData = await parseCsv(csvText);

      const [cslStyle, enLocale] = await Promise.all([
        getCslStyle(),
        fetchResource('https://raw.githubusercontent.com/citation-style-language/locales/master/locales-en-US.xml', 'English locale')
      ]);

      updateStatus('Converting data to CSL-JSON format...');
      const cslItems = jsonData.map((row, index) => createCslItem(row, index));
      
      updateStatus('Validating CSL items...');
      const { valid: validItems, errors: validationErrors } = validateCslItems(cslItems);
      
      if (validItems.length === 0) {
        throw new Error('No valid citation items found. Please check your data format.');
      }

      updateStatus(`Generating citations for ${validItems.length} valid items...`);
      const { citations, errors: citationErrors } = await generateCitations(validItems, cslStyle, enLocale);

      const allErrors = [...validationErrors, ...citationErrors];
      const warnings: string[] = [];
      
      if (validItems.length < cslItems.length) {
        warnings.push(`${cslItems.length - cslItems.length} items were skipped due to validation errors`);
      }

      const finalCsvData = jsonData.map((row, index) => {
        const correspondingCslItem = cslItems.find(csl => csl.id === `item_${index + 1}`);
        const validIndex = validItems.findIndex(validItem => validItem.id === correspondingCslItem?.id);
        
        let citation = 'Skipped due to validation errors.';
        if (validIndex !== -1) {
            citation = citations[validIndex] || 'Error: Could not generate citation.';
        }
        
        return { ...row, 'APA 7 Citation': citation };
      });

      setResult({
        success: citations.length > 0,
        citations,
        errors: allErrors,
        warnings,
        csvData: finalCsvData
      });

      if (citations.length > 0) {
        updateStatus(`Successfully generated ${citations.length} citations.`, 'success');
      } else {
        updateStatus('Failed to generate any citations. Check debug information for details.', 'error');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      addDebugInfo(`Generation failed: ${errorMessage}`);
      updateStatus(`Error: ${errorMessage}`, 'error');
      setResult({
        success: false,
        citations: [],
        errors: [errorMessage],
        warnings: [],
        csvData: []
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      updateStatus('Citation copied to clipboard!', 'success');
    } catch (error) {
      updateStatus('Failed to copy to clipboard', 'error');
    }
  };

  const downloadCsv = (): void => {
    if (!result?.csvData.length) {
      updateStatus('No data to download.', 'error');
      return;
    }
    
    // Check if Papa is available
    const Papa = (window as any).Papa;
    if (typeof Papa === 'undefined') {
      updateStatus('CSV export library not loaded. Please refresh the page and try again.', 'error');
      return;
    }
    
    const csv = Papa.unparse(result.csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'apa7_citations_output.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      setCsvFile(file);
      setGsheetUrl('');
      setActiveTab('upload');
    }
  };

  const handleCslFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    setCslFile(file);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">APA 7 Citation Generator</h1>
            <p className="text-lg text-gray-600">Convert CSV files and Google Sheets into properly formatted citations</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Input Section */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 mb-8">
          <div className="p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Data Input</h2>
            
            {/* Tab Navigation */}
            <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('upload')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'upload'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileUp className="w-4 h-4 inline mr-2" />
                Upload CSV File
              </button>
              <button
                onClick={() => setActiveTab('url')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'url'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ExternalLink className="w-4 h-4 inline mr-2" />
                Google Sheets URL
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'upload' ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-700 mb-2">
                    {csvFile ? csvFile.name : 'Drop your CSV file here'}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    or click to browse files
                  </p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <FileUp className="w-4 h-4 mr-2" />
                    Choose File
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <label htmlFor="gsheet-url" className="block text-sm font-medium text-gray-700">
                  Google Sheets Share URL
                </label>
                <input
                  type="text"
                  id="gsheet-url"
                  value={gsheetUrl}
                  onChange={(e) => {
                    setGsheetUrl(e.target.value);
                    setCsvFile(null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?usp=sharing"
                />
                <p className="text-sm text-gray-500">
                  Ensure your sheet is public or anyone with the link can view.
                </p>
              </div>
            )}

            {/* CSL File Upload */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <label htmlFor="csl-file" className="block text-sm font-medium text-gray-700 mb-2">
                Custom CSL Style File (Optional)
              </label>
              <input
                type="file"
                id="csl-file"
                accept=".csl"
                onChange={handleCslFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100 cursor-pointer"
              />
              <p className="mt-2 text-sm text-gray-500">
                {cslFile ? `Using custom style: ${cslFile.name}` : 'If not provided, the standard APA 7th edition style will be used.'}
              </p>
            </div>

            {/* Generate Button */}
            <div className="mt-8">
              <button
                onClick={handleGeneration}
                disabled={isLoading || !librariesLoaded || (!gsheetUrl && !csvFile)}
                className="w-full flex justify-center items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : !librariesLoaded ? (
                  <Library className="w-5 h-5 mr-2 animate-pulse" />
                ) : (
                  <CheckCircle className="w-5 h-5 mr-2" />
                )}
                {isLoading ? 'Generating Citations...' : !librariesLoaded ? 'Loading Libraries...' : 'Generate Citations'}
              </button>
            </div>
          </div>
        </div>

        {/* Status Message */}
        {status.message && (
          <div className={`mb-6 p-4 rounded-md ${
            status.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
            status.type === 'warning' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
            'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            <div className="flex items-center">
              {status.type === 'error' ? <AlertCircle className="w-5 h-5 mr-2" /> :
               status.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2" /> :
               <Loader2 className="w-5 h-5 mr-2" />}
              {status.message}
            </div>
          </div>
        )}

        {/* Results Section */}
        {result && (
          <div className="space-y-6">
            {/* APA Citation Guide */}
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">APA 7th Edition Citation Examples</h3>
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Quick Reference:</strong> Use these examples to format your citations correctly. 
                  For personal communications (interviews), include only in-text citations—not in the reference list.
                </p>
              </div>
              
              <div className="space-y-6 text-sm">
                <div className="border-l-4 border-blue-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">1. Journal Article</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Recent research indicates a significant correlation between sleep quality and cognitive performance (Okonjo & Adebayo, 2024).</p>
                  <p><strong>In-Text (Direct Quote):</strong> Okonjo and Adebayo (2024) found that "prolonged sleep deprivation led to a measurable decline in executive function" (p. 112).</p>
                  <p><strong>Reference:</strong> Okonjo, C. I., & Adebayo, F. A. (2024). The impact of sleep patterns on cognitive function in young adults. <em>Nigerian Journal of Health Sciences</em>, <em>15</em>(2), 105–119. https://doi.org/10.1234/njhs.2024.15.2.105</p>
                </div>

                <div className="border-l-4 border-green-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">2. Book</h4>
                  <p><strong>In-Text (Paraphrase):</strong> The historical development of West African trade routes was complex and influenced by numerous external factors (Abubakar, 2023).</p>
                  <p><strong>In-Text (Direct Quote):</strong> Abubakar (2023) notes that "the introduction of the camel was a pivotal moment for trans-Saharan commerce" (p. 47).</p>
                  <p><strong>Reference:</strong> Abubakar, Z. (2023). <em>A history of West African trade: From ancient empires to the colonial era</em>. University of Lagos Press.</p>
                </div>

                <div className="border-l-4 border-purple-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">3. Chapter in an Edited Book</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Digital literacy is now considered a fundamental skill for navigating modern information ecosystems (Eze & Bello, 2025).</p>
                  <p><strong>In-Text (Direct Quote):</strong> According to Eze and Bello (2025), "the ability to critically evaluate online sources is paramount for civic engagement" (p. 215).</p>
                  <p><strong>Reference:</strong> Eze, A. N., & Bello, S. K. (2025). Cultivating digital literacy in the 21st century. In O. C. Nwosu (Ed.), <em>Modern education: Challenges and opportunities</em> (pp. 201–225). ABU Press.</p>
                </div>

                <div className="border-l-4 border-orange-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">4. Webpage (Individual Author)</h4>
                  <p><strong>In-Text (Paraphrase):</strong> The latest agricultural techniques are helping to improve crop yields across the continent (Dauda, 2025).</p>
                  <p><strong>In-Text (Direct Quote):</strong> Dauda (2025) explained that "drip irrigation technology has reduced water consumption by up to 60% in arid regions" (para. 4).</p>
                  <p><strong>Reference:</strong> Dauda, H. (2025, May 19). <em>Sustainable farming innovations in Africa</em>. AgriInnovate Africa. https://www.agriinnovateafrica.com/sustainable-farming-innovations</p>
                </div>

                <div className="border-l-4 border-red-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">5. Webpage (Group/Organizational Author)</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Preventative measures and public awareness campaigns are crucial for managing public health crises (World Health Organization, 2024).</p>
                  <p><strong>In-Text (Direct Quote):</strong> The World Health Organization (2024) states that "timely and accurate information sharing is the cornerstone of an effective pandemic response" (p. 2).</p>
                  <p><strong>Reference:</strong> World Health Organization. (2024, January 22). <em>Global pandemic preparedness strategy</em>. https://www.who.int/publications/m/item/global-pandemic-preparedness-strategy</p>
                </div>

                <div className="border-l-4 border-indigo-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">6. Government/Organization Report</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Recent economic data suggests a steady growth in the technology sector (National Bureau of Statistics, 2024).</p>
                  <p><strong>In-Text (Direct Quote):</strong> The report from the National Bureau of Statistics (2024) highlighted that "foreign direct investment in fintech grew by 15% in the last fiscal year" (p. 18).</p>
                  <p><strong>Reference:</strong> National Bureau of Statistics. (2024). <em>Annual economic report: Technology sector analysis</em> (NBS Publication No. 2024-08). https://www.nigerianstat.gov.ng/elibrary/read/12345</p>
                </div>

                <div className="border-l-4 border-pink-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">7. Business School Case Study</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Market entry strategies for emerging economies often require significant adaptation of existing business models (Chukwuemeka & Ikenna, 2024).</p>
                  <p><strong>In-Text (Direct Quote):</strong> The note emphasizes that "local partnerships are critical for navigating regulatory and cultural landscapes" (Chukwuemeka & Ikenna, 2024, p. 5).</p>
                  <p><strong>Reference:</strong> Chukwuemeka, A., & Ikenna, M. (2024). <em>Navigating the Nigerian consumer market</em> (HBS Background Note 724-035). Harvard Business School.</p>
                </div>

                <div className="border-l-4 border-teal-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">8. Online News Article</h4>
                  <p><strong>In-Text (Paraphrase):</strong> The Nigerian government recently announced new policies to support the local technology startup ecosystem (Adekunle, 2025).</p>
                  <p><strong>In-Text (Direct Quote):</strong> Adekunle (2025) reported that the Minister of Communications and Digital Economy promised "a N10 billion fund to be disbursed over the next three years" (para. 3).</p>
                  <p><strong>Reference:</strong> Adekunle, A. (2025, July 26). Tech startups to receive new government funding. <em>The Guardian Nigeria</em>. https://guardian.ng/news/tech-startups-to-receive-new-government-funding/</p>
                </div>

                <div className="border-l-4 border-yellow-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">9. Online Magazine Article</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Effective leadership in a hybrid work environment requires a new set of communication and empathy skills (Okoro, 2024).</p>
                  <p><strong>In-Text (Direct Quote):</strong> Okoro (2024) argues, "Leaders must now be more intentional about creating connection and trust with team members who they may rarely see in person."</p>
                  <p><strong>Reference:</strong> Okoro, C. (2024, May). Leading from a distance: How to manage a hybrid team effectively. <em>Harvard Business Review</em>. https://hbr.org/2024/05/leading-from-a-distance-how-to-manage-a-hybrid-team-effectively</p>
                </div>

                <div className="border-l-4 border-gray-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">10. Dissertation/Thesis</h4>
                  <p><strong>In-Text (Paraphrase):</strong> Olawale's (2023) research explored the sociolinguistic impact of pidgin English in Nigerian media.</p>
                  <p><strong>Reference:</strong> Olawale, T. A. (2023). <em>The evolution and influence of Nigerian Pidgin English in contemporary media</em> (Publication No. 30538989) [Doctoral dissertation, University of Ibadan]. ProQuest Dissertations and Theses Global.</p>
                </div>

                <div className="border-l-4 border-cyan-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">11. Online Video</h4>
                  <p><strong>In-Text (Paraphrase):</strong> The process of creating traditional Yoruba textiles involves intricate dyeing and weaving techniques (Ademola, 2022).</p>
                  <p><strong>In-Text (Direct Quote with Timestamp):</strong> Ademola (2022) demonstrates how "the adire-eleko patterns are meticulously hand-painted with a cassava starch paste" (1:45).</p>
                  <p><strong>Reference:</strong> Ademola, K. [ArtisanKehinde]. (2022, November 3). <em>The art of Adire: Creating Yoruba textiles</em> [Video]. YouTube. https://www.youtube.com/watch?v=examplevideo</p>
                </div>

                <div className="border-l-4 border-rose-500 pl-4">
                  <h4 className="font-semibold text-gray-800 mb-2">12. Personal Communication/Interview</h4>
                  <div className="bg-amber-50 rounded p-3 mb-2">
                    <p className="text-amber-800 text-xs"><strong>Note:</strong> Personal communications are cited in-text only and do NOT appear in the reference list because they are not recoverable by readers.</p>
                  </div>
                  <p><strong>In-Text (Paraphrase):</strong> Several local logistics companies are adopting AI-powered route optimization to reduce delivery times and fuel consumption (J. Adebayo, personal communication, July 15, 2025).</p>
                  <p><strong>In-Text (Mentioning the person):</strong> According to Johnson Adebayo, the Chief Operating Officer of a major Lagos-based logistics firm, the technology has led to a 20% increase in efficiency (personal communication, July 15, 2025).</p>
                  <p><strong>Reference:</strong> <em>(Not included in the reference list)</em></p>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Generation Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{result.citations.length}</div>
                  <div className="text-sm text-green-700">Citations Generated</div>
                </div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{result.warnings.length}</div>
                  <div className="text-sm text-yellow-700">Warnings</div>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{result.errors.length}</div>
                  <div className="text-sm text-red-700">Errors</div>
                </div>
              </div>

              {result.success && (
                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={downloadCsv}
                    className="flex-1 flex items-center justify-center px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Results CSV
                  </button>
                  <button
                    onClick={() => setShowDebug(!showDebug)}
                    className="flex-1 flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                  >
                    {showDebug ? 'Hide' : 'Show'} Debug Info
                  </button>
                </div>
              )}
            </div>

            {/* Debug Information */}
            {showDebug && (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Debug Information</h3>
                <div className="bg-gray-50 rounded-md p-4 max-h-64 overflow-y-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                    {debugInfo.join('\n')}
                  </pre>
                </div>
              </div>
            )}

            {/* Citations Display */}
            {result.citations.length > 0 && (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Generated Citations</h3>
                <div className="space-y-4">
                  {result.citations.map((citation, index) => (
                    <div key={index} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-500 mb-1">Citation {index + 1}</div>
                          <div className="text-gray-900 leading-relaxed">{citation}</div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(citation)}
                          className="ml-4 p-2 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Copy to clipboard"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors and Warnings */}
            {(result.errors.length > 0 || result.warnings.length > 0) && (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Issues Found</h3>
                
                {result.errors.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-lg font-medium text-red-700 mb-2">Errors</h4>
                    <ul className="space-y-1 text-sm text-red-600">
                      {result.errors.map((error, index) => (
                        <li key={index} className="flex items-start">
                          <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.warnings.length > 0 && (
                  <div>
                    <h4 className="text-lg font-medium text-yellow-700 mb-2">Warnings</h4>
                    <ul className="space-y-1 text-sm text-yellow-600">
                      {result.warnings.map((warning, index) => (
                        <li key={index} className="flex items-start">
                          <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default App;
