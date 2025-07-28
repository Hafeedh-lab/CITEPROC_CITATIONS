import React, { useState, useCallback, useRef } from 'react';
import { FileUp, Download, Copy, CheckCircle, AlertCircle, Loader2, ExternalLink, Upload } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateStatus = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    setStatus({ message, type });
    setDebugInfo(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${type.toUpperCase()}: ${message}`]);
  }, []);

  const addDebugInfo = useCallback((info: string) => {
    setDebugInfo(prev => [...prev, `[${new Date().toLocaleTimeString()}] DEBUG: ${info}`]);
  }, []);

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
      type: mapSourceType(row['Source Type'] || '')
    };

    // Essential fields validation
    if (row['Title']) {
      item.title = String(row['Title']).trim();
    } else {
      addDebugInfo(`Item ${index + 1}: Missing title`);
    }
    
    const authors = parseAuthors(row['Author(s)'] || row['Authors'] || row['Author']);
    if (authors.length > 0) {
      item.author = authors;
    } else {
      addDebugInfo(`Item ${index + 1}: No valid authors found`);
    }

    const year = row['Year'] || row['Publication Year'] || row['Date'];
    if (year && !isNaN(parseInt(year, 10))) {
      item.issued = { 'date-parts': [[parseInt(year, 10)]] };
    } else {
      addDebugInfo(`Item ${index + 1}: Invalid or missing year: ${year}`);
    }

    const containerTitle = row['Journal'] || row['Publication'] || row['Container Title'] || row['Source'];
    if (containerTitle) {
      item['container-title'] = String(containerTitle).trim();
    }

    const volIss = parseVolumeIssue(row['Volume'] || row['Volume-Issue'] || '');
    if (volIss.volume) item.volume = volIss.volume;
    if (volIss.issue) item.issue = volIss.issue;
    else if (row['Issue']) item.issue = String(row['Issue']).trim();

    const pages = row['Pages'] || row['Page Range'] || row['Page'];
    if (pages) item.page = String(pages).trim();

    // Handle DOI/URL
    const doiField = row['DOI'] || row['DOI/URL'];
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
    
    const url = row['URL'];
    if (url && !item.DOI && !item.URL) {
      if (String(url).trim().startsWith('http')) {
        item.URL = String(url).trim();
      }
    }

    if (row['Publisher']) {
      item.publisher = String(row['Publisher']).trim();
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
        // @ts-ignore - CSL is loaded via CDN
        engine = new CSL.Engine(sys, cslStyle);
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
      // @ts-ignore - Papa is loaded via CDN
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
        warnings.push(`${cslItems.length - validItems.length} items were skipped due to validation errors`);
      }

      const finalCsvData = jsonData.map((row, index) => {
        const citation = citations[index] || 'Error: Could not generate citation.';
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
    
    // @ts-ignore - Papa is loaded via CDN
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
                disabled={isLoading || (!gsheetUrl && !csvFile)}
                className="w-full flex justify-center items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-5 h-5 mr-2" />
                )}
                {isLoading ? 'Generating Citations...' : 'Generate Citations'}
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

      {/* CDN Scripts */}
      <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/citeproc@2.4.62/citeproc.js"></script>
    </div>
  );
};

export default App;