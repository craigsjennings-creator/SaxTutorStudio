from PySide6.QtWidgets import (
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QLabel,
    QPushButton,
    QFileDialog,
    QFrame,
)
from PySide6.QtCore import Qt

from parser.musicxml_parser import load_musicxml


class MainWindow(QMainWindow):
    """Main SaxTutor Studio application window."""

    def __init__(self):
        super().__init__()

        self.setWindowTitle("SaxTutor Studio")
        self.setMinimumSize(1000, 700)

        self.setup_ui()
        self.apply_theme()

    def setup_ui(self):
        """Create the main user interface."""

        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        layout = QVBoxLayout(central_widget)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(20)

        title = QLabel("🎷 SaxTutor Studio")
        title.setObjectName("title")
        layout.addWidget(title)

        subtitle = QLabel(
            "Turn sheet music into interactive saxophone tutorials"
        )
        subtitle.setObjectName("subtitle")
        layout.addWidget(subtitle)

        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setObjectName("separator")
        layout.addWidget(separator)

        open_button = QPushButton("📂  Open MusicXML")
        open_button.setObjectName("openButton")
        open_button.setMinimumHeight(55)
        open_button.clicked.connect(self.open_musicxml)
        layout.addWidget(open_button)

        self.file_label = QLabel("No score loaded")
        self.file_label.setObjectName("fileLabel")
        self.file_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.file_label)

        notes_title = QLabel("Notes")
        notes_title.setObjectName("sectionTitle")
        layout.addWidget(notes_title)

        self.notes_label = QLabel(
            "Open a MusicXML file to see the notes here."
        )
        self.notes_label.setObjectName("notesLabel")
        self.notes_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.notes_label.setWordWrap(True)

        layout.addWidget(self.notes_label, 1)

    def open_musicxml(self):
        """Open and parse a MusicXML file."""

        filename, _ = QFileDialog.getOpenFileName(
            self,
            "Open MusicXML",
            "",
            "MusicXML Files (*.musicxml *.xml)",
        )

        if not filename:
            return

        try:
            notes = load_musicxml(filename)

            self.file_label.setText(filename)

            if not notes:
                self.notes_label.setText(
                    "The MusicXML file contains no notes."
                )
                return

            note_lines = []

            for musical_note in notes:
                if musical_note.is_rest:
                    note_lines.append(
                        f"Rest    {musical_note.duration} beats"
                    )
                else:
                    note_lines.append(
                        f"{musical_note.pitch:<6} "
                        f"{musical_note.duration} beats"
                    )

            self.notes_label.setText(
                "\n".join(note_lines)
            )

        except Exception as error:
            self.notes_label.setText(
                f"Could not load the MusicXML file.\n\n{error}"
            )

    def apply_theme(self):
        """Apply the SaxTutor Studio dark theme."""

        self.setStyleSheet("""
            QMainWindow {
                background-color: #121212;
            }

            QWidget {
                background-color: #121212;
                color: #F5F5F5;
                font-family: Segoe UI;
            }

            QLabel#title {
                font-size: 32px;
                font-weight: bold;
                color: #FFFFFF;
            }

            QLabel#subtitle {
                font-size: 15px;
                color: #AAAAAA;
            }

            QFrame#separator {
                color: #333333;
                background-color: #333333;
                max-height: 1px;
            }

            QPushButton#openButton {
                background-color: #2D6CDF;
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 16px;
                font-weight: bold;
                padding: 12px;
            }

            QPushButton#openButton:hover {
                background-color: #3D7CEF;
            }

            QPushButton#openButton:pressed {
                background-color: #2459B8;
            }

            QLabel#fileLabel {
                color: #888888;
                font-size: 13px;
                padding: 10px;
            }

            QLabel#sectionTitle {
                font-size: 20px;
                font-weight: bold;
                color: #FFFFFF;
            }

            QLabel#notesLabel {
                background-color: #1B1B1B;
                border: 1px solid #303030;
                border-radius: 8px;
                color: #888888;
                font-size: 15px;
                padding: 30px;
            }
        """)