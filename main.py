import sys

from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QLabel,
    QMainWindow,
    QPushButton,
    QVBoxLayout,
    QWidget,
    QMessageBox,
)
from PySide6.QtCore import Qt


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("SaxTutor Studio")
        self.resize(1000, 700)

        # ===== Menu =====
        menu = self.menuBar()

        file_menu = menu.addMenu("File")
        open_action = file_menu.addAction("Open MusicXML...")
        open_action.triggered.connect(self.open_musicxml)

        help_menu = menu.addMenu("Help")
        about_action = help_menu.addAction("About")
        about_action.triggered.connect(self.show_about)

        # ===== Main layout =====
        central = QWidget()
        layout = QVBoxLayout()

        self.status_label = QLabel("No music loaded")
        self.status_label.setAlignment(Qt.AlignCenter)

        open_button = QPushButton("Open MusicXML")
        open_button.setFixedHeight(40)
        open_button.clicked.connect(self.open_musicxml)

        layout.addStretch()
        layout.addWidget(self.status_label)
        layout.addWidget(open_button)
        layout.addStretch()

        central.setLayout(layout)
        self.setCentralWidget(central)

    def open_musicxml(self):
        filename, _ = QFileDialog.getOpenFileName(
            self,
            "Open MusicXML",
            "",
            "MusicXML Files (*.musicxml *.xml)"
        )

        if filename:
            self.status_label.setText(f"Loaded:\n{filename}")

    def show_about(self):
        QMessageBox.about(
            self,
            "About",
            "SaxTutor Studio\n\nVersion 0.2"
        )


app = QApplication(sys.argv)

window = MainWindow()
window.show()

sys.exit(app.exec())