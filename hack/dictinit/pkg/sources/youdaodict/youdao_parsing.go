package youdaodict

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// YoudaoWord represents the structure of a single word in the Youdao JSON format.
type YoudaoWord struct {
	WordRank int    `json:"wordRank"`
	HeadWord string `json:"headWord"`
	Content  struct {
		Word struct {
			WordHead string `json:"wordHead"`
			WordId   string `json:"wordId"`
			Content  struct {
				USPhone string `json:"usphone"`
				UKPhone string `json:"ukphone"`
				Trans   []struct {
					TranCn    string `json:"tranCn"`
					Pos       string `json:"pos"`
					TranOther string `json:"tranOther"`
				} `json:"trans"`
				Syno struct {
					Synos []struct {
						Pos  string `json:"pos"`
						Tran string `json:"tran"`
						Hwds []struct {
							W string `json:"w"`
						} `json:"hwds"`
					} `json:"synos"`
				} `json:"syno"`
				Anto struct { // Antonyms
					Antos []struct {
						Pos  string `json:"pos"`
						Tran string `json:"tran"`
						Hwds []struct {
							W string `json:"w"`
						} `json:"hwds"`
					} `json:"antos"`
				} `json:"anto"`
				RelWord struct {
					Rels []struct {
						Pos   string `json:"pos"`
						Words []struct {
							Hwd  string `json:"hwd"`
							Tran string `json:"tran"`
						} `json:"words"`
					} `json:"rels"`
				} `json:"relWord"`
			} `json:"content"`
		} `json:"word"`
	} `json:"content"`
	BookId string `json:"bookId"`
}

// MapPOS maps Youdao POS tags to Lexeme POS tags.
func MapPOS(youdaoPOS string) string {
	pos := strings.ToLower(strings.TrimSuffix(youdaoPOS, "."))
	switch pos {
	case "n":
		return "n."
	case "v", "vt", "vi":
		return "v."
	case "adj", "a":
		return "adj."
	case "adv", "ad":
		return "adv."
	case "prep":
		return "prep."
	case "conj":
		return "conj."
	case "pron":
		return "pron."
	case "num":
		return "num."
	case "art":
		return "det."
	case "int":
		return "interj."
	default:
		return ""
	}
}

// LoadYoudaoZip parses all JSON files inside a Youdao zip archive.
func LoadYoudaoZip(zipPath string) ([]YoudaoWord, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	var allWords []YoudaoWord
	for _, f := range r.File {
		if !strings.HasSuffix(f.Name, ".json") {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open file %s in zip: %w", f.Name, err)
		}

		decoder := json.NewDecoder(rc)
		for {
			var word YoudaoWord
			if err := decoder.Decode(&word); err != nil {
				if err == io.EOF {
					break
				}
				continue
			}
			allWords = append(allWords, word)
		}
		rc.Close()
	}

	return allWords, nil
}

// GetZipFiles returns a list of all .zip files in the given directory.
func GetZipFiles(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.zip"))
	if err != nil {
		return nil, err
	}
	return files, nil
}
