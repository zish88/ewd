import os
import glob
import subprocess
import sys

def main():
    manual_dir = "/data/manual"
    target_name = "Электросхемы XC70 rus.pdf"
    target_path = os.path.join(manual_dir, target_name)

    # 1. Ищем все PDF в папке
    pdf_files = glob.glob(os.path.join(manual_dir, "*.pdf"))
    
    if not pdf_files:
        print(f"❌ Ошибка: В {manual_dir} не найдено ни одного PDF файла!")
        sys.exit(1)

    print(f"Найден PDF: {pdf_files[0]}")

    # 2. Если файла с 'rus' нет, создаем симлинк на найденный PDF
    if not os.path.exists(target_path):
        try:
            os.symlink(pdf_files[0], target_path)
            print(f"✅ Создана ссылка: {target_path} -> {pdf_files[0]}")
        except Exception as e:
            print(f"⚠️ Не удалось создать ссылку: {e}")

    # 3. Запускаем основной импорт
    actual_pdf = target_path if os.path.exists(target_path) else pdf_files[0]
    cmd = [sys.executable, "scripts/full_reimport.py", "--pdf", actual_pdf]
    
    print(f"🚀 Запускаем импорт: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)

if __name__ == "__main__":
    main()