import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';

import * as path from 'path';
import * as QuillRef from './quill';
import Quill from 'quill';

import { ElectronService } from '../services';

import { SourceOfTruth, RenameObject, RenamedObject, defaultOptions } from './interfaces';

import { HelperService } from './helper.service';

@Component({
  selector: 'app-root',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements AfterViewInit, OnInit {

  @ViewChild('editor1', { static: true }) editorNode1: ElementRef; // input file
  @ViewChild('editor2', { static: true }) editorNode2: ElementRef; // editable one
  @ViewChild('editor3', { static: true }) editorNode3: ElementRef; // input overlay (deletions)
  @ViewChild('editor4', { static: true }) editorNode4: ElementRef; // output overlay (additions)

  @ViewChild('scrollOriginal', { static: true }) scrollOriginal: ElementRef; // holds editor 1 & 2
  @ViewChild('scrollDiff',     { static: true }) scrollDiff: ElementRef;     // holds editor 3 & 4

  editor1: Quill;
  editor2: Quill;
  editor3: Quill;
  editor4: Quill;

  appInFocus = true;
  editingInTXT = false;
  hover = false;

  compareIcons: RenamedObject[] | RenameObject[] = [];
  sourceOfTruth: SourceOfTruth[] = [];

  mode: 'review' | 'edit' = 'edit';

  finalReport = {
    failed: 0,
    renamed: 0,
    unchanged: 0,
  };

  // error modal
  errorModalShowing = false;
  numberOfSuccesses: number = 0;
  allErrors: any = {};

  @HostListener('document:keypress', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // if editor has selection & user is typing, hide the diff overlay
    if (this.mode === 'edit' && this.editor2.getSelection() !== null) {
      this.hover = true;
    }
  }

  @HostListener('window:blur', ['$event'])
  onBlur(event: any): void {
    this.appInFocus = false;
  }

  @HostListener('window:focus', ['$event'])
  onFocus(event: any): void {
    this.appInFocus = true;
    if (this.editingInTXT && this.mode === 'edit') {
      // if user is returning to window, they may have edited the txt file
      this.electronService.ipcRenderer.send('app-back-in-focus', undefined);
    }
  }

  // needs to be above `keyBindings` else maybe it doesn't work?
  toggler = () => {
    this.findDiff();
    this.hover = !this.hover;
  }

  // tslint:disable-next-line: member-ordering
  keyBindings: any = {
    tab: {
      key: 9,
      handler: this.toggler,
    },
    enter: {
      key: 13,
      handler: this.toggler,
    },
    esc: {
      key: 27,
      handler: this.toggler,
    }
  };

  constructor(
    public electronService: ElectronService,
    public helperService: HelperService,
  ) { }

  ngOnInit() {
    this.electronService.ipcRenderer.send('just-started');

    this.electronService.ipcRenderer.on('file-chosen', (event, filePath: string[]) => {
      this.addToFileList(filePath);
    });

    this.electronService.ipcRenderer.on('txt-file-updated', (event, newText: string) => {
      const newOps: any = {
        ops: [{
          insert: newText
        }]
      };
      this.editor2.setContents(newOps);
      this.findDiff();
    });

    this.electronService.ipcRenderer.on('renaming-report', (event, report: RenamedObject[]) => {
      this.mode = 'review';
      this.editor2.disable(); // sets to `readOnly`
      this.compareIcons = report;

      this.finalReport = {
        failed: 0,
        renamed: 0,
        unchanged: 0,
      };

      report.forEach(element => {
        switch (element.result) {
          case 'renamed':
            this.finalReport.renamed++;
            break;
          case 'unchanged':
            this.finalReport.unchanged++;
            break;
          case 'error':
            this.finalReport.failed++;
            break;
        }
      });
    });

  }

  // Set up to handle drag & drop of files
  ngAfterViewInit() {
    document.ondragover = document.ondrop = (ev) => {
      ev.preventDefault();
    };

    document.body.ondrop = (ev) => {
      if (ev.dataTransfer.files.length > 0) {
        const fileListObject: any = ev.dataTransfer.files;
        ev.preventDefault();
        if (fileListObject) {

          const fileList: string[] = [];

          for (let i = 0; i < fileListObject.length; i++) {
            fileList.push(fileListObject[i].path);
          }

          if (this.mode === 'edit') {
            this.addToFileList(fileList);
          }
        }
      }
    };

    // set up Quill
    const customOptions = defaultOptions;
    const readOnly = JSON.parse(JSON.stringify(defaultOptions));
    readOnly.readOnly = true;
    customOptions.modules.keyboard.bindings = this.keyBindings;
    this.editor1 = new QuillRef.Quill(this.editorNode1.nativeElement, readOnly);
    this.editor2 = new QuillRef.Quill(this.editorNode2.nativeElement, defaultOptions);
    this.editor3 = new QuillRef.Quill(this.editorNode3.nativeElement, readOnly);
    this.editor4 = new QuillRef.Quill(this.editorNode4.nativeElement, readOnly);
  }

  /**
   * Add files to current list
   * 1) don't add unless it's a file not on the list
   * 2) append _input_ and _output_ with new filename
   * 3) reload the diff view
   * @param files
   */
  addToFileList(files: string[]) {
    const input = this.editor1.getContents();
    const output = this.editor2.getContents();

    // clean up remove the `\n` at the beginning
    const newInput = { ops: [] };
    input.ops.forEach((element) => {
      if (element.insert !== '\n') { // do not include the first line
        newInput.ops.push(element);
      }
    });

    const newOutput = { ops: [] };
    output.ops.forEach((element) => {
      if (element.insert !== '\n') { // do not include the first line
        newOutput.ops.push(element);
      }
    });

    files.forEach((file: string) => {

      const currentFile = path.parse(file);

      if (currentFile.ext) { // only add if extension exists (else it's a folder)

        let fileAlreadyAdded: boolean = false;

        // Validate the file hasn't been added yet
        this.sourceOfTruth.forEach((element) => {
          if (
               element.filename  === currentFile.name
            && element.path      === currentFile.dir
            && element.extension === currentFile.ext
          ) {
            fileAlreadyAdded = true;
          }
        });

        if (!fileAlreadyAdded) {

          this.sourceOfTruth.push({
            extension: currentFile.ext,
            filename: currentFile.name,
            path: currentFile.dir,
          });

          newInput.ops.push({ insert: currentFile.name + '\n' });
          newOutput.ops.push({ insert: currentFile.name + '\n' });
        }
      }
    });

    this.editor1.setContents(<any>newInput);
    this.editor2.setContents(<any>newOutput);

    this.findDiff();
  }

  /**
   * Generate the deletions/additions markup and render
   */
  findDiff() {
    const oldContent = this.editor1.getContents();
    const newContent = this.editor2.getContents();

    const deleteOnly = this.helperService.find_deletions(oldContent, newContent);
    const addOnly = this.helperService.find_additions(oldContent, newContent);

    this.editor3.setContents(deleteOnly);
    this.editor4.setContents(addOnly);

    this.compareIcons = this.getNewSourceOfTruth();
  }

  // ======================= UI INTERRACTIONS ======================================================

  /**
   * Update UI after mouse enters the text editing area
   */
  mouseEntered() {
    if (this.mode === 'edit') {
      this.hover = true;
    }
  }

  /**
   * Update UI after mouse leaves the text editing area
   * 1) find the diff
   * 2) align the scrolling location, both X & Y
   */
  mouseLeft() {
    if (this.mode === 'edit') {

      this.findDiff();

      const scrollTop: number = this.scrollOriginal.nativeElement.scrollTop;
      const scrollLeft: number = this.editorNode2.nativeElement.scrollLeft;

      this.scrollDiff.nativeElement.scrollTop = scrollTop;
      this.editorNode4.nativeElement.scrollLeft = scrollLeft;

      this.hover = false;
    }
  }

  /**
   * Open system dialog for adding new file or files
   */
  addFile() {
    this.electronService.ipcRenderer.send('choose-file');
  }

  /**
   * Open the filenames with system's default .txt editor
   */
  openTXT() {
    this.editingInTXT = true;
    this.electronService.ipcRenderer.send('open-txt-file', this.editor2.getText());
  }

  /**
   * Start the rename process -- send data to Node
   *
   * Send the whole list to Node
   * Node will annotate it and return it back with `error`, `success`, or `unchanged`
   *
   */
  renameStuff(): void {
    this.electronService.ipcRenderer.send('rename-these-files', this.getNewSourceOfTruth());
  }

  /**
   * Generate new `sourceOfTruth` object with `newFilename` field
   */
  getNewSourceOfTruth(): RenameObject[] {
    const fileNames = this.editor2.getText().split('\n');
    fileNames.pop(); // last element always `\n'

    // now do renaming against `sourceOfTruth`
    const newSourceOfTruth: RenameObject[] = [];

    this.sourceOfTruth.forEach((element, index) => {
      newSourceOfTruth.push({
        path: element.path,
        filename: element.filename,
        extension: element.extension,
        newFilename:  fileNames[index],
      });
    });

    return newSourceOfTruth;
  }

  /**
   * Reset the app to ~ initial state
   */
  restart(): void {
    this.sourceOfTruth = [];
    this.editor1.setContents(<any>[]);
    this.editor2.setContents(<any>[]);
    this.findDiff();
    this.editor2.enable();
    this.mode = 'edit';
  }

}
